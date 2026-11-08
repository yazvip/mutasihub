package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"mutasi-hub/internal/connecta"
)

// --- Member bank account inquiry (SNAP via Connecta) ---
//
// POST /api/v1/inquiry/bank-account — member only, gated by the member's
// ACTIVE plan: plans.inquiry_enabled must be 1, otherwise 403
// inquiry_disabled. The admin endpoint
// POST /api/v1/admin/connecta/dana/account-inquiry bypasses the gate
// (admin-only, no plan involved).
//
// Urutan gate (v24): auth -> paket inquiry_enabled (403) -> rate limit
// 30/menit -> limit harian paket (429 inquiry_limit_reached) -> provider.
// Rate limit sengaja SETELAH gate paket: request dari paket yang
// inquiry-nya mati tidak menghabiskan budget per-menit member.
//
// Limit harian (v24): plans.inquiry_limit = maks hit/hari per member,
// tanggal dihitung di Go dalam WIB (inquiry_usage_daily). NULL = tanpa
// batas, 0 = tidak ada hit diizinkan. Counter naik HANYA setelah
// provider menjawab (sukses atau hasil definitif); error/timeout
// provider tidak memotong hit.
// Audit: every call is logged as member/bank_inquiry (bank code only,
// never the account number).

var (
	accountNumberRe = regexp.MustCompile(`^[0-9]{5,20}$`)
	bankCodeRe      = regexp.MustCompile(`^[0-9]{3,4}$`)
)

func (s *Server) handleBankInquiry(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	// Gate: paket aktif member harus mengizinkan inquiry.
	plan, err := s.loadInquiryPlan(r.Context(), id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusForbidden, "inquiry_disabled", "fitur inquiry rekening tidak aktif di paket kamu")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa paket")
		return
	}
	if !plan.Enabled {
		writeErr(w, http.StatusForbidden, "inquiry_disabled", "fitur inquiry rekening tidak aktif di paket kamu")
		return
	}
	if !s.limiter.Allow("inquiry:"+id, 30) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak inquiry, coba lagi sebentar lagi")
		return
	}
	var req struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.BankCode = strings.TrimSpace(req.BankCode)
	req.AccountNumber = strings.TrimSpace(req.AccountNumber)
	if !bankCodeRe.MatchString(req.BankCode) || !accountNumberRe.MatchString(req.AccountNumber) {
		writeErr(w, http.StatusBadRequest, "invalid_request", "kode bank (3-4 digit) dan nomor rekening (5-20 digit angka) wajib diisi")
		return
	}
	// Cek limit harian (pre-check; pengecekan otoritatif terjadi di
	// recordInquiryUsage setelah provider menjawab, supaya dua request
	// bersamaan tidak bisa sama-sama lolos di sisa kuota terakhir).
	today := wibToday(time.Now())
	used, err := s.readInquiryUsed(r.Context(), id, today)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa pemakaian inquiry")
		return
	}
	if allowed, _ := inquiryLimitRemaining(plan.Limit, used); !allowed {
		writeInquiryLimitReached(w, plan.Limit)
		return
	}
	raw, err := s.connecta.DanaAccountInquiry(r.Context(), req.BankCode, req.AccountNumber)
	if err != nil {
		// Error/timeout provider: hit TIDAK dipotong.
		// v28: log ke api.log (sebelumnya hanya audit) agar insiden
		// provider meninggalkan jejak — error transport (mis. redirect
		// loop Connecta) tidak menghasilkan baris log client sama sekali.
		s.log.Printf("http: bank inquiry: provider gagal: %v", err)
		// P2-12: inquiry gagal diaudit (sebelumnya hanya jalur sukses).
		s.audit(r, "member", id, "bank_inquiry_failed", "bank "+req.BankCode)
		status, code, msg := classifyInquiryError(err)
		writeErr(w, status, code, msg)
		return
	}
	var env struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			AccountName   string `json:"account_name"`
			AccountNumber string `json:"account_number"`
			BankCode      string `json:"bank_code"`
			BankName      string `json:"bank_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		// Body provider tidak bisa diparse = bukan jawaban definitif:
		// hit tidak dipotong; jawab 503 generik (bukan 404 — rekening
		// belum tentu tidak ditemukan, providernya yang bermasalah).
		s.log.Printf("http: bank inquiry: respons provider tidak bisa diparse: %v", err)
		s.audit(r, "member", id, "bank_inquiry_failed", "bank "+req.BankCode)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan inquiry sedang gangguan, coba lagi nanti")
		return
	}
	if !env.Success {
		// Jawaban definitif provider: rekening tidak ditemukan di bank
		// tersebut. Provider sudah menjawab, jadi hit dipotong seperti
		// jalur sukses.
		if _, reached, err := s.recordInquiryUsage(r.Context(), id, today, plan.Limit); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mencatat pemakaian inquiry")
			return
		} else if reached {
			writeInquiryLimitReached(w, plan.Limit)
			return
		}
		m := env.Message
		if m == "" {
			m = "rekening tidak ditemukan di bank tersebut"
		}
		writeErr(w, http.StatusNotFound, "inquiry_not_found", m)
		return
	}
	usedAfter, reached, err := s.recordInquiryUsage(r.Context(), id, today, plan.Limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mencatat pemakaian inquiry")
		return
	}
	if reached {
		// Request lain menghabiskan sisa kuota saat provider menjawab.
		writeInquiryLimitReached(w, plan.Limit)
		return
	}
	s.audit(r, "member", id, "bank_inquiry", "bank "+req.BankCode)
	_, remaining := inquiryLimitRemaining(plan.Limit, usedAfter)
	writeJSON(w, http.StatusOK, map[string]any{
		"account_name":    env.Data.AccountName,
		"account_number":  env.Data.AccountNumber,
		"bank_code":       env.Data.BankCode,
		"bank_name":       env.Data.BankName,
		"limit_today":     nullableIntJSON(plan.Limit),
		"remaining_today": nullableIntJSON(remaining),
	})
}

// --- Limit harian inquiry (v24) ---
//
// Tanggal pemakaian dihitung di Go dalam WIB (Asia/Jakarta) dari
// time.Now() — JANGAN dari jam MySQL (server DB berjalan di CST) dan
// JANGAN ubah time_zone sesi MySQL (aturan P1-6).

// wibToday mengembalikan tanggal hari ini dalam WIB ("2006-01-02").
func wibToday(now time.Time) string {
	return now.In(wibLoc).Format("2006-01-02")
}

// nextWIBMidnight mengembalikan 00:00 WIB berikutnya (awal hari
// pemakaian baru) sebagai instant berzona WIB.
func nextWIBMidnight(now time.Time) time.Time {
	t := now.In(wibLoc)
	y, mo, d := t.Date()
	return time.Date(y, mo, d+1, 0, 0, 0, 0, wibLoc)
}

// inquiryLimitRemaining memutuskan gate limit harian (pure, tanpa DB):
// limit nil = tanpa batas (lolos, remaining nil); selain itu lolos bila
// used < limit. remaining dijepit di 0 (tidak pernah negatif — mis.
// bila admin menurunkan limit di tengah hari saat used sudah di atasnya).
func inquiryLimitRemaining(limit *int, used int) (allowed bool, remaining *int) {
	if limit == nil {
		return true, nil
	}
	rem := *limit - used
	if rem < 0 {
		rem = 0
	}
	return used < *limit, &rem
}

// nullableIntJSON merender *int sebagai JSON null (tanpa batas) atau
// angkanya — dipakai untuk limit_today / remaining_today.
func nullableIntJSON(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// writeInquiryLimitReached menjawab 429 inquiry_limit_reached dengan
// limit_today + remaining_today 0. Ditulis lewat writeJSON (bukan
// writeErr) karena bentuk error standar hanya membawa error+message.
func writeInquiryLimitReached(w http.ResponseWriter, limit *int) {
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error":           "inquiry_limit_reached",
		"message":         "batas inquiry harian paket kamu sudah habis, coba lagi besok",
		"limit_today":     nullableIntJSON(limit),
		"remaining_today": 0,
	})
}

// inquiryPlan adalah gate inquiry dari paket aktif member.
type inquiryPlan struct {
	Enabled bool
	Limit   *int // nil = tanpa batas
}

// loadInquiryPlan membaca gate inquiry paket aktif member.
// sql.ErrNoRows = tidak ada langganan aktif yang belum kedaluwarsa.
func (s *Server) loadInquiryPlan(ctx context.Context, memberID string) (inquiryPlan, error) {
	var p inquiryPlan
	var inq int
	var limit sql.NullInt32
	err := s.store.DB.QueryRowContext(ctx, `SELECT p.inquiry_enabled, p.inquiry_limit
		FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW()
		ORDER BY sub.expires_at DESC LIMIT 1`, memberID).Scan(&inq, &limit)
	if err != nil {
		return p, err
	}
	p.Enabled = inq == 1
	p.Limit = nullInt32ToPtr(limit)
	return p, nil
}

// readInquiryUsed mengembalikan hit yang sudah dipakai member pada
// tanggal WIB tertentu (0 bila belum ada baris).
func (s *Server) readInquiryUsed(ctx context.Context, memberID, date string) (int, error) {
	var used int
	err := s.store.DB.QueryRowContext(ctx, `SELECT used FROM inquiry_usage_daily WHERE member_id=? AND usage_date=?`, memberID, date).Scan(&used)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return used, nil
}

// SQL pemakaian harian inquiry — konstanta agar pola penguncian bisa
// diasertikan tes (tidak ada MySQL lokal; lihat inquiry_limit_test.go).
const (
	inquiryUsageSelectSQL = `SELECT used FROM inquiry_usage_daily WHERE member_id=? AND usage_date=? FOR UPDATE`
	inquiryUsageInsertSQL = `INSERT INTO inquiry_usage_daily (member_id, usage_date, used) VALUES (?, ?, 1)`
	inquiryUsageUpdateSQL = `UPDATE inquiry_usage_daily SET used = used + 1 WHERE member_id=? AND usage_date=?`
)

// inquiryIncrementAction adalah hasil keputusan increment atas baris
// yang sudah terkunci SELECT ... FOR UPDATE.
type inquiryIncrementAction int

const (
	incrementInsert  inquiryIncrementAction = iota // baris belum ada -> INSERT used=1
	incrementUpdate                                // baris ada, masih ada sisa -> UPDATE used+1
	incrementReached                               // limit sudah habis -> jangan tulis apa pun
)

// inquiryIncrementDecision memutuskan langkah increment dari baris yang
// terkunci (pure, tanpa DB — unit-testable). limit nil = tanpa batas;
// limit 0 = tidak ada hit diizinkan, bahkan untuk baris baru.
// used yang sudah melewati limit (mis. admin menurunkan limit di tengah
// hari) juga ditolak, dan newUsed tidak pernah melebihi limit.
func inquiryIncrementDecision(limit *int, rowExists bool, used int) (inquiryIncrementAction, int) {
	if limit != nil && *limit <= 0 {
		return incrementReached, used
	}
	if !rowExists {
		return incrementInsert, 1
	}
	if limit != nil && used >= *limit {
		return incrementReached, used
	}
	return incrementUpdate, used + 1
}

// recordInquiryUsage menaikkan hit harian SETELAH provider menjawab.
// Mengembalikan used sesudah hit ini; limitReached=true bila hit ini
// tidak jadi dicatat karena limit sudah habis (balapan dengan request
// lain yang menghabiskan sisa kuota saat provider menjawab).
//
// Pola: transaksi + SELECT ... FOR UPDATE, lalu INSERT (baris baru) atau
// UPDATE used=used+1. Alasan pola ini — bukan INSERT ... ON DUPLICATE
// KEY UPDATE dengan IF(used < limit, used+1, used):
//   - upsert kondisional satu statement memang atomik, tapi hasilnya
//     hanya bisa dibedakan lewat RowsAffected (1 = insert, 2 = update
//     berubah, 0 = update tanpa perubahan) — semantik yang rapuh karena
//     bergantung pada flag CLIENT_FOUND_ROWS driver dan mudah salah
//     baca oleh maintainer berikutnya;
//   - SELECT ... FOR UPDATE mengunci baris (atau gap-nya bila baris
//     belum ada) sehingga keputusan "masih ada sisa / sudah habis"
//     dibuat atas nilai TERKINI yang terkunci, bukan snapshot lama.
//     Dua request bersamaan untuk member+tanggal yang sama diserialkan
//     oleh lock: yang kedua baru membaca setelah yang pertama commit,
//     jadi used tidak pernah melewati limit;
//   - biaya satu round-trip ekstra per inquiry sukses dapat diterima
//     (endpoint sudah dibatasi 30/menit per member).
func (s *Server) recordInquiryUsage(ctx context.Context, memberID, date string, limit *int) (usedAfter int, limitReached bool, err error) {
	tx, err := s.store.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()
	var used int
	err = tx.QueryRowContext(ctx, inquiryUsageSelectSQL, memberID, date).Scan(&used)
	rowExists := err == nil
	if err != nil && err != sql.ErrNoRows {
		return 0, false, err
	}
	action, newUsed := inquiryIncrementDecision(limit, rowExists, used)
	switch action {
	case incrementReached:
		return used, true, nil
	case incrementInsert:
		if _, err := tx.ExecContext(ctx, inquiryUsageInsertSQL, memberID, date); err != nil {
			return 0, false, err
		}
	case incrementUpdate:
		if _, err := tx.ExecContext(ctx, inquiryUsageUpdateSQL, memberID, date); err != nil {
			return 0, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, false, err
	}
	return newUsed, false, nil
}

// handleInquiryUsage — GET /api/v1/inquiry/usage (member).
// {inquiry_enabled, limit_today, used_today, remaining_today, resets_at}
// limit_today/remaining_today null bila tanpa batas; resets_at = 00:00
// WIB berikutnya (RFC3339 +07:00). Tanpa langganan aktif -> 403
// inquiry_disabled (sama seperti inquiry). Paket inquiry mati ->
// inquiry_enabled false + limit_today null + remaining_today null
// (used_today tetap angka pemakaian hari ini bila ada — mis. paket
// dimatikan admin di tengah hari setelah member sempat memakai).
func (s *Server) handleInquiryUsage(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	plan, err := s.loadInquiryPlan(r.Context(), id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusForbidden, "inquiry_disabled", "fitur inquiry rekening tidak aktif di paket kamu")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa paket")
		return
	}
	today := wibToday(time.Now())
	used, err := s.readInquiryUsed(r.Context(), id, today)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa pemakaian inquiry")
		return
	}
	resetsAt := formatWIB(nextWIBMidnight(time.Now()))
	if !plan.Enabled {
		writeJSON(w, http.StatusOK, map[string]any{
			"inquiry_enabled": false,
			"limit_today":     nil,
			"used_today":      used,
			"remaining_today": nil,
			"resets_at":       resetsAt,
		})
		return
	}
	_, remaining := inquiryLimitRemaining(plan.Limit, used)
	writeJSON(w, http.StatusOK, map[string]any{
		"inquiry_enabled": true,
		"limit_today":     nullableIntJSON(plan.Limit),
		"used_today":      used,
		"remaining_today": nullableIntJSON(remaining),
		"resets_at":       resetsAt,
	})
}

// transientProviderSignals: pesan upstream yang menandakan gangguan
// sementara di sisi bank/provider, bukan kesalahan input member.
var transientProviderSignals = []string{
	"SERVICE_TEMPORARILY_UNAVAILABLE",
	"BANK_SERVICE_UNAVAILABLE",
	"LIMIT_EXCEEDED",
}

// classifyInquiryError memetakan error Connecta ke status/kode/pesan
// member-facing (dipakai handler member dan admin playground):
//   - sinyal gangguan sementara, status upstream 5xx, atau timeout
//     transport -> 503 provider_unavailable;
//   - upstream 4xx lain -> status yang sama dengan pesan provider yang
//     sudah disanitasi (tidak pernah body mentah / nama vendor / path);
//   - error non-HTTP lain -> 503 generik.
func classifyInquiryError(err error) (status int, code, msg string) {
	const unavailableMsg = "layanan bank sedang gangguan, coba lagi nanti"
	const genericMsg = "layanan inquiry sedang gangguan, coba lagi nanti"
	text := err.Error()
	for _, sig := range transientProviderSignals {
		if strings.Contains(text, sig) {
			return http.StatusServiceUnavailable, "provider_unavailable", unavailableMsg
		}
	}
	var herr *connecta.HTTPError
	if errors.As(err, &herr) {
		switch {
		case herr.Status >= 500:
			return http.StatusServiceUnavailable, "provider_unavailable", unavailableMsg
		case herr.Status >= 400:
			m := sanitizedProviderMessage(herr.Body)
			code := "invalid_request"
			if herr.Status == http.StatusNotFound {
				code = "inquiry_not_found"
			}
			if m == "" {
				switch herr.Status {
				case http.StatusNotFound:
					m = "rekening tidak ditemukan di bank tersebut"
				case http.StatusUnprocessableEntity:
					m = "permintaan inquiry ditolak bank/provider"
				default:
					m = "permintaan inquiry tidak valid"
				}
			}
			return herr.Status, code, m
		}
	}
	if lower := strings.ToLower(text); strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded") {
		return http.StatusServiceUnavailable, "provider_unavailable", unavailableMsg
	}
	return http.StatusServiceUnavailable, "provider_error", genericMsg
}

// sanitizedProviderMessage mengambil field message/error dari body JSON
// upstream bila bisa diparse dan aman diteruskan; mengembalikan "" bila
// tidak ada pesan yang layak (pemanggil memakai pesan generik). Nama
// vendor, path internal, dan potongan JSON mentah tidak pernah lolos.
func sanitizedProviderMessage(body string) string {
	var doc map[string]any
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		return ""
	}
	candidates := []map[string]any{doc}
	if data, ok := doc["data"].(map[string]any); ok {
		candidates = append(candidates, data)
	}
	for _, m := range candidates {
		for _, k := range []string{"message", "error"} {
			v, ok := m[k].(string)
			if !ok {
				continue
			}
			v = strings.TrimSpace(v)
			if v == "" {
				continue
			}
			low := strings.ToLower(v)
			if strings.Contains(low, "connecta") || strings.Contains(v, "/b2b/") || strings.HasPrefix(v, "{") {
				continue
			}
			if len(v) > 200 {
				v = v[:200]
			}
			return v
		}
	}
	return ""
}

// normalizeBankCodes extracts [{code, name}] from a Connecta bank-codes
// payload (array under data/banks/list, items with code|bank_code and
// name|bank_name). Returns nil when the shape is not recognized.
func normalizeBankCodes(raw json.RawMessage) []map[string]string {
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	for _, key := range []string{"data", "banks", "list"} {
		arr, ok := doc[key].([]any)
		if !ok {
			continue
		}
		banks := []map[string]string{}
		for _, item := range arr {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			code, _ := firstString(m, "code", "bank_code")
			name, _ := firstString(m, "name", "bank_name")
			if code == "" || name == "" {
				continue
			}
			banks = append(banks, map[string]string{"code": code, "name": name})
		}
		if len(banks) > 0 {
			return banks
		}
	}
	return nil
}

// handleBankCodes proxies the provider bank-code list for the member
// inquiry form, normalized to {banks: [{code, name}]} when the shape is
// recognized. P2-2: bila normalisasi gagal, jawab 503 generik — JANGAN
// passthrough body mentah provider ke member.
func (s *Server) handleBankCodes(w http.ResponseWriter, r *http.Request) {
	raw, err := s.connecta.DanaBankCodes(r.Context())
	if err != nil {
		s.log.Printf("http: bank codes gagal: %v", err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memuat daftar bank, coba lagi nanti")
		return
	}
	if banks := normalizeBankCodes(raw); banks != nil {
		writeJSON(w, http.StatusOK, map[string]any{"banks": banks})
		return
	}
	s.log.Printf("http: bank codes: bentuk payload provider tidak dikenali")
	writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memuat daftar bank, coba lagi nanti")
}

// handleAdminBankCodes is the admin-side twin of handleBankCodes, for the
// admin playground (admin session, no member plan involved). Sama seperti
// versi member: gagal normalisasi -> 503 generik, tanpa passthrough.
func (s *Server) handleAdminBankCodes(w http.ResponseWriter, r *http.Request) {
	raw, err := s.connecta.DanaBankCodes(r.Context())
	if err != nil {
		s.log.Printf("http: admin bank codes gagal: %v", err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memuat daftar bank, coba lagi nanti")
		return
	}
	if banks := normalizeBankCodes(raw); banks != nil {
		writeJSON(w, http.StatusOK, map[string]any{"banks": banks})
		return
	}
	s.log.Printf("http: admin bank codes: bentuk payload provider tidak dikenali")
	writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memuat daftar bank, coba lagi nanti")
}

func firstString(m map[string]any, keys ...string) (string, bool) {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v, true
		}
	}
	return "", false
}

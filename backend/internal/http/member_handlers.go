package http

import (
	"context"
	"crypto/hmac"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mutasi-hub/internal/connecta"
	"mutasi-hub/internal/crypto"
	"mutasi-hub/internal/domain"
)

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	ctx := r.Context()
	var siteName string
	siteName, _ = s.store.GetSetting(ctx, "site_name")
	if siteName == "" {
		siteName = "MutasiHub"
	}
	var totalMut, totalIn, totalOut int64
	_ = s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*),
		COALESCE(SUM(CASE WHEN type='CR' THEN amount_cents ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN type='DB' THEN amount_cents ELSE 0 END),0)
		FROM mutations WHERE member_id=?`, id).Scan(&totalMut, &totalIn, &totalOut)
	var activeAccounts int
	_ = s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM linked_accounts WHERE member_id=? AND status='active'`, id).Scan(&activeAccounts)
	var planName, planExpires string
	planExpired := false
	err := s.store.DB.QueryRowContext(ctx, `SELECT p.name, sub.expires_at FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() ORDER BY sub.expires_at DESC LIMIT 1`, id).Scan(&planName, &planExpires)
	if err != nil {
		// Tidak ada paket aktif yang belum kedaluwarsa: tampilkan
		// plan null + plan_expired agar frontend tidak menampilkan
		// paket kedaluwarsa sebagai aktif.
		planExpired = true
	}
	resp := map[string]any{
		"site_name": siteName, "total_mutations": totalMut,
		"total_in_cents": totalIn, "total_out_cents": totalOut,
		"active_accounts": activeAccounts,
		"plan":            planName, "plan_expires_at": formatWIBString(planExpires),
		"plan_expired": planExpired,
	}
	if planExpired {
		resp["plan"] = nil
		resp["plan_expires_at"] = nil
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var email, name string
	var callback, cbSecret sql.NullString
	var cbEnabled int
	// v42a: callback_enabled = paket aktif member mengizinkan callback
	// (Enterprise). Dipakai halaman /member/api untuk menampilkan status
	// + upsell bila paket tidak mengizinkan.
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT m.email, m.name, m.callback_url, m.callback_secret,
		COALESCE(p.callback_enabled,0)=1 FROM members m
		LEFT JOIN subscriptions sub ON sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW()
		LEFT JOIN plans p ON p.id=sub.plan_id
		WHERE m.id=? ORDER BY sub.expires_at DESC LIMIT 1`, id).
		Scan(&email, &name, &callback, &cbSecret, &cbEnabled)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "member tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "email": email, "name": name, "callback_url": callback.String,
		// Secret HMAC callback milik member sendiri (P2-8): dipakai
		// memverifikasi header X-MutasiHub-Signature. Kosong sampai
		// callback pertama terkirim (secret di-generate saat itu).
		"callback_secret":  cbSecret.String,
		"callback_enabled": cbEnabled == 1,
	})
}

// --- Linked accounts ---

type accountRowOut struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	Label         string `json:"label"`
	PhoneMasked   string `json:"phone_masked,omitempty"`
	AccountMasked string `json:"account_masked,omitempty"`
	Status        string `json:"status"`
	BalanceCents  int64  `json:"balance_cents"`
	LastSyncedAt  string `json:"last_synced_at,omitempty"`
	// v34: tanggal tambah (created_at) + tanggal otorisasi pertama
	// (authorized_at, NULL bila belum pernah diotorisasi — termasuk
	// rekening aktif lama sebelum migrasi 0015, yang tidak di-backfill).
	CreatedAt    string `json:"created_at,omitempty"`
	AuthorizedAt string `json:"authorized_at,omitempty"`
	// SyncPaused: rekening ini dibekukan dari sync karena paket aktif
	// member max_accounts-nya lebih kecil dari jumlah rekening
	// terhubung (v30: yang paling dulu dihubungkan dipertahankan).
	SyncPaused bool      `json:"sync_paused"`
	createdAt  time.Time `json:"-"`
}

func (s *Server) handleListAccounts(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, provider, label,
		COALESCE(phone_masked,''), COALESCE(account_masked,''), status, balance_cents, last_synced_at, created_at, authorized_at
		FROM linked_accounts WHERE member_id=? ORDER BY created_at DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca rekening")
		return
	}
	defer rows.Close()
	out := []accountRowOut{}
	for rows.Next() {
		var a accountRowOut
		var last sql.NullTime
		var auth sql.NullTime
		if err := rows.Scan(&a.ID, &a.Provider, &a.Label, &a.PhoneMasked, &a.AccountMasked, &a.Status, &a.BalanceCents, &last, &a.createdAt, &auth); err != nil {
			continue
		}
		if last.Valid {
			a.LastSyncedAt = formatWIB(last.Time)
		}
		a.CreatedAt = formatWIB(a.createdAt)
		if auth.Valid {
			a.AuthorizedAt = formatWIB(auth.Time)
		}
		out = append(out, a)
	}
	// Beku sync (v30): hitung dari max_accounts paket AKTIF member,
	// logika sama dengan PollOnce (domain.FrozenAccountIDs). Tanpa
	// paket aktif, sync memang tidak jalan (PollOnce mensyaratkan
	// subscription aktif) — semua rekening terhubung berstatus dijeda.
	var maxAccounts int
	var hasActive bool
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(p.max_accounts, 2) FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() LIMIT 1`, id).Scan(&maxAccounts); err == nil {
		hasActive = true
	}
	limit := 0
	if hasActive {
		limit = maxAccounts
	}
	candidates := []domain.FreezeCandidate{}
	for _, a := range out {
		if a.Status == "active" || a.Status == "pending" {
			candidates = append(candidates, domain.FreezeCandidate{ID: a.ID, CreatedAt: a.createdAt})
		}
	}
	frozen := domain.FrozenAccountIDs(candidates, limit)
	for i := range out {
		out[i].SyncPaused = frozen[out[i].ID]
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": out})
}

type createAccountReq struct {
	Provider  string `json:"provider"` // DANA | BCA
	Phone     string `json:"phone"`
	AccountNo string `json:"account_no"`
	UserID    string `json:"user_id"`
	Pin       string `json:"pin"`
	Label     string `json:"label"`
}

var (
	danaPhoneRe = regexp.MustCompile(`^[0-9]{9,15}$`)
	bcaUserIDRe = regexp.MustCompile(`^[A-Za-z0-9]{6,20}$`)
	bcaPinRe    = regexp.MustCompile(`^[0-9]{6}$`)
)

func (s *Server) handleCreateAccount(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	id, _ := memberID(r)
	var req createAccountReq
	if !readJSON(w, r, &req) {
		return
	}
	provider := strings.ToUpper(strings.TrimSpace(req.Provider))
	if provider != "DANA" && provider != "BCA" {
		writeErr(w, http.StatusBadRequest, "invalid_provider", "provider harus DANA atau BCA")
		return
	}
	// Validasi format SEBELUM cek limit / enkripsi / panggilan Connecta.
	if len(strings.TrimSpace(req.Label)) > 100 {
		writeErr(w, http.StatusBadRequest, "invalid_request", "label maksimal 100 karakter")
		return
	}
	switch provider {
	case "DANA":
		phone := strings.TrimSpace(req.Phone)
		if !danaPhoneRe.MatchString(phone) || (!strings.HasPrefix(phone, "08") && !strings.HasPrefix(phone, "628")) {
			writeErr(w, http.StatusBadRequest, "invalid_phone", "nomor HP DANA harus 9-15 digit angka dan diawali 08 atau 628")
			return
		}
	case "BCA":
		if !accountNumberRe.MatchString(strings.TrimSpace(req.AccountNo)) {
			writeErr(w, http.StatusBadRequest, "invalid_request", "nomor rekening BCA harus 5-20 digit angka")
			return
		}
		if !bcaUserIDRe.MatchString(strings.TrimSpace(req.UserID)) {
			writeErr(w, http.StatusBadRequest, "invalid_request", "user ID KlikBCA harus 6-20 karakter alfanumerik")
			return
		}
		if !bcaPinRe.MatchString(strings.TrimSpace(req.Pin)) {
			writeErr(w, http.StatusBadRequest, "invalid_request", "PIN KlikBCA harus 6 digit angka")
			return
		}
	}
	if provider == "BCA" {
		// Limit partner Connecta: hanya 1 akun BCA di seluruh platform
		// (semua member). Sync BCA tanpa filter per-rekening akan
		// mencampur mutasi antar-member bila ada lebih dari satu.
		var bcaCount int
		// P2-16: hitung hanya rekening AKTIF/relevan (active/pending),
		// bukan semua baris.
		_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM linked_accounts WHERE provider='BCA' AND status IN ('active','pending')`).Scan(&bcaCount)
		if bcaCount > 0 {
			writeErr(w, http.StatusConflict, "bca_limit", "akun BCA sudah terhubung (limit partner: 1 akun BCA)")
			return
		}
	}
	// Subscription + plan limit check.
	var maxAccounts int
	var subOK bool
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(p.max_accounts, 2) FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() LIMIT 1`, id).Scan(&maxAccounts)
	subOK = err == nil
	if !subOK {
		writeErr(w, http.StatusForbidden, "subscription_expired", "langganan tidak aktif, perpanjang dulu")
		return
	}
	var current int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM linked_accounts WHERE member_id=? AND status IN ('active','pending')`, id).Scan(&current)
	if current >= maxAccounts {
		writeErr(w, http.StatusForbidden, "account_limit", fmt.Sprintf("paket Anda maksimal %d rekening (saat ini %d terhubung)", maxAccounts, current))
		return
	}

	acctID := newID()
	var credJSON, phoneMasked, acctMasked string
	status := "pending"
	var bindingURL string
	switch provider {
	case "DANA":
		phone := strings.TrimSpace(req.Phone)
		if len(phone) < 9 || len(phone) > 15 {
			writeErr(w, http.StatusBadRequest, "invalid_phone", "nomor HP DANA harus 9-15 digit")
			return
		}
		raw, _ := json.Marshal(map[string]string{"phone": phone})
		enc, err := crypto.Encrypt(s.encKey, string(raw))
		if err != nil {
			s.log.Printf("http: create account: encrypt gagal: %v", err)
			writeErr(w, http.StatusInternalServerError, "encryption_error", "gagal menyimpan rekening")
			return
		}
		credJSON, phoneMasked = enc, crypto.MaskPhone(phone)
		if s.connecta.Available() {
			redirectURL := strings.TrimRight(s.cfg.FrontendURL, "/") + "/member/accounts?dana=callback"
			rawBinding, err := s.connecta.DanaBinding(r.Context(), phone, id, redirectURL)
			if err != nil {
				// P2-2: detail upstream hanya ke log server.
				s.log.Printf("http: create account: binding DANA gagal member=%s: %v", id, err)
				writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan penyedia sedang gangguan, coba lagi nanti")
				return
			}
			// Connecta mengembalikan oauth_url DANA yang WAJIB dibuka
			// member untuk otorisasi — tanpa itu binding tak pernah
			// selesai dan akun stuck pending selamanya.
			bindingURL = parseBindingURL(rawBinding)
		}
	case "BCA":
		if strings.TrimSpace(req.AccountNo) == "" || strings.TrimSpace(req.UserID) == "" || strings.TrimSpace(req.Pin) == "" {
			writeErr(w, http.StatusBadRequest, "invalid_bca", "account_no, user_id dan pin wajib diisi")
			return
		}
		raw, _ := json.Marshal(map[string]string{
			"account_no": strings.TrimSpace(req.AccountNo),
			"user_id":    strings.TrimSpace(req.UserID),
			"pin":        strings.TrimSpace(req.Pin),
		})
		enc, err := crypto.Encrypt(s.encKey, string(raw))
		if err != nil {
			s.log.Printf("http: create account: encrypt gagal: %v", err)
			writeErr(w, http.StatusInternalServerError, "encryption_error", "gagal menyimpan rekening")
			return
		}
		credJSON, acctMasked = enc, crypto.MaskAccountNumber(req.AccountNo)
		if s.connecta.Available() {
			if _, err := s.connecta.BCAAccountSave(r.Context(), req.AccountNo, req.UserID, req.Pin); err != nil {
				s.log.Printf("http: create account: simpan BCA gagal member=%s: %v", id, err)
				writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan penyedia sedang gangguan, coba lagi nanti")
				return
			}
		}
		// BCA tidak punya langkah otorisasi lanjutan (tidak seperti
		// OAuth DANA): bila Connecta berhasil menyimpan, langsung aktif.
		status = "active"
	}
	// P2-16: INSERT di dalam transaksi; untuk BCA, hitung ulang slot
	// dengan SELECT ... FOR UPDATE (migrasi 0012 menambah index
	// provider agar range lock menahan insert BCA bersamaan). Cek
	// limit di awal tidak cukup — dua create bersamaan bisa sama-sama
	// lolos (TOCTOU).
	tx, txErr := s.store.DB.BeginTx(r.Context(), nil)
	if txErr != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan rekening")
		return
	}
	defer tx.Rollback()
	if provider == "BCA" {
		var lockedCount int
		if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM linked_accounts
			WHERE provider='BCA' AND status IN ('active','pending') FOR UPDATE`).Scan(&lockedCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan rekening")
			return
		}
		if lockedCount > 0 {
			writeErr(w, http.StatusConflict, "bca_limit", "akun BCA sudah terhubung (limit partner: 1 akun BCA)")
			return
		}
	}
	// v34: BCA langsung aktif saat dibuat (tidak ada OAuth lanjutan):
	// catat tanggal otorisasi = saat pembuatan. DANA tetap NULL sampai
	// webhook binding / self-heal sync mengaktifkan.
	authorizedAt := sql.NullTime{}
	if status == "active" {
		authorizedAt = sql.NullTime{Time: time.Now(), Valid: true}
	}
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO linked_accounts
		(id, member_id, provider, label, phone_masked, account_masked, credential_ciphertext, status, authorized_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		acctID, id, provider, strings.TrimSpace(req.Label), phoneMasked, acctMasked, credJSON, status, authorizedAt); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan rekening")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan rekening")
		return
	}
	s.audit(r, "member", id, "account_create", provider+" account "+acctID)
	resp := map[string]any{
		"id": acctID, "provider": provider, "status": status,
		"phone_masked": phoneMasked, "account_masked": acctMasked,
	}
	if bindingURL != "" {
		resp["binding_url"] = bindingURL
	}
	writeJSON(w, http.StatusCreated, resp)
}

// parseBindingURL mengambil oauth_url DANA dari respons binding Connecta
// (bentuk docs: {data:{oauth_url}}; fallback: oauth_url top-level).
func parseBindingURL(raw json.RawMessage) string {
	var v struct {
		Data struct {
			OAuthURL string `json:"oauth_url"`
		} `json:"data"`
		OAuthURL string `json:"oauth_url"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	if v.Data.OAuthURL != "" {
		return v.Data.OAuthURL
	}
	return v.OAuthURL
}

func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	acctID := r.PathValue("id")
	res, err := s.store.DB.ExecContext(r.Context(), `DELETE FROM linked_accounts WHERE id=? AND member_id=?`, acctID, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghapus rekening")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "rekening tidak ditemukan")
		return
	}
	s.audit(r, "member", id, "account_delete", "account "+acctID)
	writeJSON(w, http.StatusOK, map[string]any{"message": "rekening dihapus"})
}

// handleRebindDANA membuat ulang link otorisasi OAuth DANA untuk sebuah
// rekening DANA yang masih pending. Link binding v6 hanya tampil sesaat
// setelah tambah rekening — tanpa endpoint ini, member yang me-reload
// halaman (atau yang rekeningnya dibuat sebelum v6) tidak bisa lagi
// mendapatkan link tanpa hapus + tambah ulang.
func (s *Server) handleRebindDANA(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	acctID := r.PathValue("id")
	var provider, credJSON, status string
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT provider, credential_ciphertext, status
		FROM linked_accounts WHERE id=? AND member_id=?`, acctID, id).Scan(&provider, &credJSON, &status)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "rekening tidak ditemukan")
		return
	}
	if strings.ToUpper(provider) != "DANA" {
		writeErr(w, http.StatusBadRequest, "invalid_provider", "hanya rekening DANA yang butuh otorisasi")
		return
	}
	if status == "active" {
		writeErr(w, http.StatusConflict, "already_active", "rekening sudah aktif")
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	plain, err := crypto.Decrypt(s.encKey, credJSON)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "decrypt_error", "gagal membaca kredensial rekening")
		return
	}
	var cred struct {
		Phone string `json:"phone"`
	}
	if err := json.Unmarshal([]byte(plain), &cred); err != nil || strings.TrimSpace(cred.Phone) == "" {
		writeErr(w, http.StatusInternalServerError, "credential_error", "nomor DANA tidak ditemukan")
		return
	}
	if !s.connecta.Available() {
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan penyedia belum tersedia, coba lagi nanti")
		return
	}
	redirectURL := strings.TrimRight(s.cfg.FrontendURL, "/") + "/member/accounts?dana=callback"
	rawBinding, err := s.connecta.DanaBinding(r.Context(), strings.TrimSpace(cred.Phone), id, redirectURL)
	if err != nil {
		s.log.Printf("http: rebind DANA gagal member=%s: %v", id, err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan penyedia sedang gangguan, coba lagi nanti")
		return
	}
	bindingURL := parseBindingURL(rawBinding)
	if bindingURL == "" {
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "penyedia tidak mengembalikan link otorisasi, coba lagi nanti")
		return
	}
	s.audit(r, "member", id, "account_rebind", "DANA account "+acctID)
	writeJSON(w, http.StatusOK, map[string]any{"binding_url": bindingURL})
}

// handleDanaReversal meneruskan callback redirect DANA ke Connecta (v43).
//
// Alur OAuth DANA: member otorisasi di DANA lalu browser mendarat di
// /member/accounts?dana=callback&auth_code=...&state=... — auth_code itu
// sekali pakai dengan TTL 60 detik. Sebelum v43 halaman hanya membaca
// param dana dan menampilkan banner, sehingga kode kedaluwarsa tanpa
// pernah dipakai dan rekening stuck pending selamanya (webhook Connecta
// yang seharusnya mengaktifkan juga ditolak 401).
//
// Per dokumen + contoh curl Connecta terbaru: panggil POST
// /api/v1/reversal-dana dengan body {"callback_url", "partner_id"},
// header Content-Type + User-Agent ConnectaWebhook/1.0, TANPA X-API-KEY
// (endpoint publik; auth_code + partner_id adalah kredensialnya).
// Sukses 200 mengembalikan data akun (status ACTIVE, nomor HP, saldo,
// OTT) — dari nomor HP itu kami cocokkan rekening lokal member dan
// mengaktifkannya langsung, tanpa menunggu webhook.
//
// Keamanan: callback_url WAJIB mengarah ke host + path redirect kita
// sendiri (jangan teruskan URL sembarangan ke Connecta); auth_code dan
// OTT TIDAK PERNAH masuk log/audit — hanya id member + hasil.
func (s *Server) handleDanaReversal(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	if !s.limiter.Allow("dana-reversal:"+id, 5) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak percobaan, tunggu sebentar lalu coba lagi")
		return
	}
	var req struct {
		CallbackURL string `json:"callback_url"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	cb, err := url.Parse(strings.TrimSpace(req.CallbackURL))
	if err != nil || cb.Scheme == "" || cb.Host == "" {
		writeErr(w, http.StatusBadRequest, "invalid_callback_url", "URL callback tidak valid")
		return
	}
	// Guard: hanya teruskan URL redirect milik kita sendiri.
	fe, ferr := url.Parse(strings.TrimRight(s.cfg.FrontendURL, "/"))
	if ferr != nil || !strings.EqualFold(cb.Host, fe.Host) || cb.Path != "/member/accounts" || cb.Query().Get("dana") != "callback" {
		writeErr(w, http.StatusBadRequest, "invalid_callback_url", "URL callback bukan dari halaman rekening MutasiHub")
		return
	}
	if cb.Query().Get("auth_code") == "" {
		writeErr(w, http.StatusBadRequest, "missing_auth_code", "kode otorisasi DANA tidak ditemukan di URL callback")
		return
	}
	if strings.TrimSpace(s.cfg.ConnectaBaseURL) == "" || strings.TrimSpace(s.cfg.ConnectaPartnerID) == "" {
		writeErr(w, http.StatusServiceUnavailable, "reversal_not_configured", "penerusan callback DANA belum dikonfigurasi, hubungi admin")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	raw, _, err := s.connecta.DanaReversal(ctx, strings.TrimSpace(req.CallbackURL), s.cfg.ConnectaPartnerID)
	if err != nil {
		var he *connecta.HTTPError
		if errors.As(err, &he) {
			s.log.Printf("http: dana reversal gagal member=%s: HTTP %d", id, he.Status)
			var body struct {
				Code string `json:"code"`
			}
			_ = json.Unmarshal([]byte(he.Body), &body)
			if body.Code == "AUTH_CODE_EXPIRED" {
				writeErr(w, http.StatusBadRequest, "auth_code_expired", "Kode otorisasi DANA sudah kedaluwarsa (60 detik). Klik 'Hubungkan DANA' lagi untuk mendapatkan kode baru.")
				return
			}
			writeErr(w, http.StatusBadGateway, "provider_error", "penyedia menolak penerusan callback, coba lagi nanti")
			return
		}
		s.log.Printf("http: dana reversal gagal member=%s: %v", id, err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "layanan penyedia sedang gangguan, coba lagi nanti")
		return
	}
	var rev struct {
		Success bool `json:"success"`
		Data    struct {
			AccountID   string  `json:"account_id"`
			AccountName string  `json:"account_name"`
			PhoneNumber string  `json:"phone_number"`
			Status      string  `json:"status"`
			Balance     float64 `json:"balance_amount"`
			OTT         string  `json:"ott"`
			PartnerID   string  `json:"partner_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &rev); err != nil || !rev.Success {
		s.log.Printf("http: dana reversal: respons tidak bisa dibaca member=%s", id)
		writeErr(w, http.StatusBadGateway, "provider_error", "penyedia mengembalikan respons yang tidak dikenal, coba lagi nanti")
		return
	}
	// Cocokkan rekening lokal dari nomor HP di respons (bukan dari URL —
	// nomor di URL bisa apa saja; nomor dari Connecta adalah yang
	// diotorisasi). Cocokkan setelah normalisasi digit (62 -> 0).
	phone := normalizeDanaPhone(rev.Data.PhoneNumber)
	if phone == "" {
		writeErr(w, http.StatusBadGateway, "provider_error", "penyedia tidak mengembalikan nomor HP, coba lagi nanti")
		return
	}
	acctID, phoneMasked, curStatus, found := s.findMemberDANAAccount(r.Context(), id, phone)
	if !found {
		writeErr(w, http.StatusNotFound, "account_not_found", "Nomor DANA yang diotorisasi tidak cocok dengan rekening terdaftar. Periksa nomornya lalu hubungkan lagi.")
		return
	}
	if curStatus == "active" {
		writeJSON(w, http.StatusOK, map[string]any{
			"account_id": acctID, "status": "active", "already_active": true,
			"phone_masked": phoneMasked,
			"message":      "DANA sudah aktif.",
		})
		return
	}
	if !strings.EqualFold(rev.Data.Status, "ACTIVE") {
		writeJSON(w, http.StatusOK, map[string]any{
			"account_id": acctID, "status": strings.ToLower(rev.Data.Status),
			"phone_masked": phoneMasked,
			"message":      "Reversal berhasil tapi status akun di penyedia: " + rev.Data.Status + ". Tunggu sebentar lalu refresh halaman.",
		})
		return
	}
	balanceCents := int64(math.Round(rev.Data.Balance * 100))
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE linked_accounts
		SET status='active', authorized_at=COALESCE(authorized_at, NOW()), balance_cents=?, last_synced_at=NOW()
		WHERE id=? AND member_id=?`, balanceCents, acctID, id); err != nil {
		s.log.Printf("http: dana reversal: aktivasi gagal member=%s account=%s: %v", id, acctID, err)
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan rekening, coba lagi nanti")
		return
	}
	s.audit(r, "member", id, "account_dana_reversal", "DANA account "+acctID)
	writeJSON(w, http.StatusOK, map[string]any{
		"account_id": acctID, "status": "active", "balance_cents": balanceCents,
		"phone_masked": phoneMasked,
		"message":      "DANA berhasil terhubung dan aktif.",
	})
}

// normalizeDanaPhone menyamakan nomor HP DANA: hanya digit, awalan 62
// diubah ke 0. Dipakai untuk mencocokkan nomor dari respons Connecta
// dengan nomor yang tersimpan di kredensial terenkripsi member.
func normalizeDanaPhone(p string) string {
	var b strings.Builder
	for _, r := range p {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if strings.HasPrefix(d, "62") {
		d = "0" + d[2:]
	}
	return d
}

// findMemberDANAAccount mencari rekening DANA milik member yang nomornya
// cocok (setelah normalisasi). Mengembalikan id, nomor ter-mask, dan
// status saat ini. Kredensial didekripsi satu per satu — member normalnya
// punya segelintir rekening, jadi ini murah.
func (s *Server) findMemberDANAAccount(ctx context.Context, memberID, phone string) (acctID, phoneMasked, status string, found bool) {
	rows, err := s.store.DB.QueryContext(ctx, `SELECT id, credential_ciphertext, COALESCE(phone_masked,''), status
		FROM linked_accounts WHERE member_id=? AND provider='DANA'`, memberID)
	if err != nil {
		return "", "", "", false
	}
	defer rows.Close()
	for rows.Next() {
		var id, credJSON, masked, st string
		if err := rows.Scan(&id, &credJSON, &masked, &st); err != nil {
			continue
		}
		if len(s.encKey) == 0 {
			continue
		}
		plain, err := crypto.Decrypt(s.encKey, credJSON)
		if err != nil {
			continue
		}
		var cred struct {
			Phone string `json:"phone"`
		}
		if err := json.Unmarshal([]byte(plain), &cred); err != nil {
			continue
		}
		if normalizeDanaPhone(cred.Phone) == phone {
			return id, masked, st, true
		}
	}
	return "", "", "", false
}

// escapeLike escapes LIKE wildcards (%, _, \) so a sender filter
// matches literally; the query uses ESCAPE '\' (P2-5).
// senderLikeClause returns the LIKE fragment for the sender filter.
// The SQL text must carry two backslashes after ESCAPE (ESCAPE '\\'):
// with one backslash MySQL reads \' as an escaped quote and the string
// never closes (error 1064, P2-5). The Go literal therefore needs four.
func senderLikeClause() string {
	return " AND sender LIKE ? ESCAPE '\\\\'"
}

func escapeLike(v string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(v)
}

// --- Mutasi (session OR API key) ---

// csvExportMaxRows caps one CSV export; more rows than this are truncated
// and flagged with the X-CSV-Truncated response header.
const csvExportMaxRows = 5000

func (s *Server) handleMutasi(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authenticateMutasi(w, r)
	if !ok {
		return
	}
	if !s.requireDB(w) {
		return
	}
	q := r.URL.Query()
	// P2-14: format selain "csv"/kosong -> 400 (dulu diam-diam JSON).
	if f := q.Get("format"); f != "" && f != "csv" {
		writeErr(w, http.StatusBadRequest, "invalid_param", "parameter format harus csv atau kosong")
		return
	}
	args := []any{member}
	where := "WHERE member_id=?"
	if v := q.Get("from"); v != "" {
		if _, err := time.Parse("2006-01-02", v); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter from tidak valid (format YYYY-MM-DD)")
			return
		}
		where += " AND tx_date >= ?"
		args = append(args, v)
	}
	if v := q.Get("to"); v != "" {
		if _, err := time.Parse("2006-01-02", v); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter to tidak valid (format YYYY-MM-DD)")
			return
		}
		// Tanggal saja berarti akhir hari: < hari berikutnya, bukan
		// <= tengah malam tanggal itu.
		where += " AND tx_date < DATE_ADD(?, INTERVAL 1 DAY)"
		args = append(args, v)
	}
	var minAmount, maxAmount int64
	var hasMin, hasMax bool
	if v := q.Get("min_amount"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter min_amount harus bilangan bulat")
			return
		}
		minAmount, hasMin = n, true
		where += " AND amount_cents >= ?"
		args = append(args, n)
	}
	if v := q.Get("max_amount"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter max_amount harus bilangan bulat")
			return
		}
		maxAmount, hasMax = n, true
		where += " AND amount_cents <= ?"
		args = append(args, n)
	}
	if hasMin && hasMax && minAmount > maxAmount {
		writeErr(w, http.StatusBadRequest, "invalid_param", "min_amount tidak boleh lebih besar dari max_amount")
		return
	}
	if v := q.Get("sender"); v != "" {
		where += senderLikeClause()
		args = append(args, "%"+escapeLike(v)+"%")
	}
	if v := q.Get("type"); v != "" {
		t := strings.ToUpper(v)
		if t != "CR" && t != "DB" {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter type harus CR atau DB")
			return
		}
		where += " AND type=?"
		args = append(args, t)
	}
	if v := q.Get("provider"); v != "" {
		p := strings.ToUpper(v)
		if p != "DANA" && p != "BCA" {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter provider harus DANA atau BCA")
			return
		}
		where += " AND provider=?"
		args = append(args, p)
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("page_size"))
	if size < 1 || size > 100 {
		size = 20
	}
	offset := (page - 1) * size
	isCSV := q.Get("format") == "csv"
	// Export CSV mengabaikan paginasi, dengan cap eksplisit agar tidak
	// menumpahkan seluruh tabel; bila terpotong, header di bawah
	// memberi tahu frontend.
	limit := size
	if isCSV {
		limit = csvExportMaxRows
		offset = 0
	}

	var total int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mutations `+where, args...).Scan(&total)

	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT provider, tx_date, type, amount_cents,
		COALESCE(description,''), COALESCE(sender,'') FROM mutations `+where+` ORDER BY tx_date DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca mutasi")
		return
	}
	defer rows.Close()
	type mut struct {
		Provider    string `json:"provider"`
		Date        string `json:"date"`
		Type        string `json:"type"`
		AmountCents int64  `json:"amount_cents"`
		Description string `json:"description"`
		Sender      string `json:"sender"`
	}
	out := []mut{}
	for rows.Next() {
		var m mut
		var d time.Time
		if err := rows.Scan(&m.Provider, &d, &m.Type, &m.AmountCents, &m.Description, &m.Sender); err != nil {
			continue
		}
		m.Date = formatWIBWallClock(d)
		out = append(out, m)
	}
	if isCSV {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=mutasi.csv")
		w.Header().Set("X-Total-Count", strconv.Itoa(total))
		if total > csvExportMaxRows {
			w.Header().Set("X-CSV-Truncated", "true")
		}
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"provider", "date", "type", "amount_cents", "description", "sender"})
		for _, m := range out {
			_ = cw.Write([]string{m.Provider, m.Date, m.Type, strconv.FormatInt(m.AmountCents, 10), m.Description, m.Sender})
		}
		cw.Flush()
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": out, "page": page, "page_size": size, "total": total,
	})
}

// --- API keys ---

func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, key_prefix, scope,
		COALESCE(ip_whitelist,''), is_active, last_used_at, created_at, expires_at FROM api_keys WHERE member_id=? ORDER BY created_at DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca API keys")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var kid, prefix, scope, ips string
		var active int
		var last, expires sql.NullTime
		var created time.Time
		if err := rows.Scan(&kid, &prefix, &scope, &ips, &active, &last, &created, &expires); err != nil {
			continue
		}
		item := map[string]any{"id": kid, "key_prefix": prefix, "scope": scope,
			"ip_whitelist": ips, "is_active": active == 1, "created_at": formatWIB(created)}
		if last.Valid {
			item["last_used_at"] = formatWIB(last.Time)
		}
		if expires.Valid {
			item["expires_at"] = formatWIB(expires.Time)
		} else {
			item["expires_at"] = nil
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"api_keys": out})
}

func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var req struct {
		Scope       string `json:"scope"`
		IPWhitelist string `json:"ip_whitelist"`
		ExpiresAt   string `json:"expires_at"` // opsional, RFC3339, harus di masa depan
	}
	if r.ContentLength != 0 {
		if !readJSON(w, r, &req) {
			return
		}
	}
	// P2-22: batas 5 key AKTIF per member.
	var activeKeys int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM api_keys
		WHERE member_id=? AND is_active=1 AND (expires_at IS NULL OR expires_at > NOW())`, id).Scan(&activeKeys)
	if activeKeys >= 5 {
		writeErr(w, http.StatusConflict, "api_key_limit", "maksimal 5 API key aktif per member; nonaktifkan atau hapus key lama dulu")
		return
	}
	var expiresAt any
	var expiresOut any
	if strings.TrimSpace(req.ExpiresAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil || !t.After(time.Now()) {
			writeErr(w, http.StatusBadRequest, "invalid_expires_at", "expires_at harus tanggal RFC3339 di masa depan")
			return
		}
		expiresAt = t
		expiresOut = formatWIB(t)
	}
	raw := "mh_" + randomToken()
	prefix := raw[:11]
	_, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO api_keys
		(id, member_id, key_hash, key_prefix, scope, ip_whitelist, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, newID(), id, sha256Hex(raw), prefix,
		firstNonEmpty(req.Scope, "all"), req.IPWhitelist, expiresAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat API key")
		return
	}
	s.audit(r, "member", id, "api_key_create", "prefix "+prefix)
	// Plaintext is shown exactly once.
	writeJSON(w, http.StatusCreated, map[string]any{
		"api_key": raw, "key_prefix": prefix, "expires_at": expiresOut,
		"message": "simpan API key ini, tidak akan ditampilkan lagi",
	})
}

func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	res, err := s.store.DB.ExecContext(r.Context(), `DELETE FROM api_keys WHERE id=? AND member_id=?`, r.PathValue("id"), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghapus API key")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "API key tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "API key dihapus"})
}

func firstNonEmpty(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// --- Plans & subscriptions ---

func (s *Server) handlePlans(w http.ResponseWriter, r *http.Request) {
	if !s.store.Available() {
		writeJSON(w, http.StatusOK, map[string]any{"plans": domain.DefaultPlans()})
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, slug, name, price_cents, duration_days,
		max_accounts, api_delay_minutes, notif_interval_minutes, callback_enabled, inquiry_enabled, inquiry_limit, is_active
		FROM plans WHERE is_active=1 ORDER BY price_cents`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca paket")
		return
	}
	defer rows.Close()
	plans := []domain.Plan{}
	for rows.Next() {
		var p domain.Plan
		var cb, inq, active int
		var limit sql.NullInt32
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.PriceCents, &p.DurationDays, &p.MaxAccounts,
			&p.APIDelayMinutes, &p.NotifIntervalMin, &cb, &inq, &limit, &active); err != nil {
			continue
		}
		p.CallbackEnabled = cb == 1
		p.InquiryEnabled = inq == 1
		p.InquiryLimit = nullInt32ToPtr(limit)
		p.IsActive = active == 1
		plans = append(plans, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": plans})
}

func (s *Server) handleListSubscriptions(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT sub.id, p.slug, p.name, sub.status,
		sub.starts_at, sub.expires_at FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? ORDER BY sub.created_at DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca langganan")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var sid, slug, name, status string
		var starts, expires sql.NullTime
		if err := rows.Scan(&sid, &slug, &name, &status, &starts, &expires); err != nil {
			continue
		}
		// P2-11: status 'active' yang sudah lewat expires_at
		// ditampilkan sebagai 'expired' (tidak ada job yang mengubah
		// status di DB; status efektif dihitung di sini).
		effective := status
		if status == "active" && expires.Valid && time.Now().After(expires.Time) {
			effective = "expired"
		}
		item := map[string]any{"id": sid, "plan_slug": slug, "plan_name": name, "status": effective}
		if starts.Valid {
			item["starts_at"] = formatWIB(starts.Time)
		}
		if expires.Valid {
			item["expires_at"] = formatWIB(expires.Time)
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": out})
}

// --- Ganti paket (v30) ---
//
// Satu member hanya punya maksimal 1 langganan aktif. Pembatalan paket
// lama terjadi SAAT AKTIVASI (bukan saat order dibuat): klaim gratis
// membatalkan langsung, paket berbayar membatalkan saat callback Gobiz
// paid. Order pending TIDAK membatalkan apa pun.

// replaceFreezeItem adalah satu rekening yang akan dibekukan sync-nya
// bila member pindah ke paket baru (di luar max_accounts paket baru).
type replaceFreezeItem struct {
	ID        string
	Provider  string
	Masked    string
	CreatedAt time.Time
}

// replaceConflict merangkum paket aktif berbeda yang menghalangi
// pembelian paket baru tanpa konfirmasi.
type replaceConflict struct {
	OldPlanName    string
	OldExpiresAt   time.Time
	NewPlanName    string
	NewMaxAccounts int
	NewPriceCents  int64
	ConnectedCount int
	WouldFreeze    []replaceFreezeItem
}

// remainingDaysUntil menghitung sisa hari (dibulatkan ke atas, min 0)
// dari now sampai expires — dipakai untuk old_plan.remaining_days.
func remainingDaysUntil(expires, now time.Time) int {
	days := int(math.Ceil(expires.Sub(now).Hours() / 24))
	if days < 0 {
		return 0
	}
	return days
}

// payload merender konflik ganti paket sebagai JSON error datar
// (pola writeInquiryLimitReached: error+message + field tambahan).
func (c *replaceConflict) payload(now time.Time) map[string]any {
	freeze := []map[string]any{}
	for _, f := range c.WouldFreeze {
		freeze = append(freeze, map[string]any{
			"id": f.ID, "provider": f.Provider, "masked": f.Masked,
			"created_at": formatWIB(f.CreatedAt),
		})
	}
	return map[string]any{
		"error":   "active_subscription_exists",
		"message": fmt.Sprintf("Anda masih memiliki paket %s yang aktif sampai %s. Konfirmasi penggantian untuk beralih ke paket %s — paket lama akan dibatalkan dan rekening di luar batas paket baru dijeda sinkronisasinya.", c.OldPlanName, formatWIB(c.OldExpiresAt), c.NewPlanName),
		"old_plan": map[string]any{
			"name": c.OldPlanName, "expires_at": formatWIB(c.OldExpiresAt),
			"remaining_days": remainingDaysUntil(c.OldExpiresAt, now),
		},
		"new_plan": map[string]any{
			"name": c.NewPlanName, "max_accounts": c.NewMaxAccounts,
			"price_cents": c.NewPriceCents,
		},
		"connected_count": c.ConnectedCount,
		"would_freeze":    freeze,
	}
}

func writeReplaceConflict(w http.ResponseWriter, c *replaceConflict) {
	writeJSON(w, http.StatusConflict, c.payload(time.Now()))
}

// loadReplaceConflict mencari langganan aktif member untuk plan
// BERBEDA. nil, nil = tidak ada paket aktif lain (tidak ada konflik).
func (s *Server) loadReplaceConflict(ctx context.Context, memberID string, newPlan domain.Plan) (*replaceConflict, error) {
	var oldName string
	var oldExpires time.Time
	err := s.store.DB.QueryRowContext(ctx, `SELECT p.name, sub.expires_at FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() AND sub.plan_id<>?
		ORDER BY sub.expires_at DESC LIMIT 1`, memberID, newPlan.ID).Scan(&oldName, &oldExpires)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.store.DB.QueryContext(ctx, `SELECT id, provider,
		COALESCE(phone_masked,''), COALESCE(account_masked,''), created_at
		FROM linked_accounts WHERE member_id=? AND status IN ('active','pending')
		ORDER BY created_at ASC, id ASC`, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	candidates := []domain.FreezeCandidate{}
	items := []replaceFreezeItem{}
	for rows.Next() {
		var it replaceFreezeItem
		var phoneMasked, acctMasked string
		if err := rows.Scan(&it.ID, &it.Provider, &phoneMasked, &acctMasked, &it.CreatedAt); err != nil {
			continue
		}
		// masked = phone_masked untuk DANA, account_masked untuk BCA.
		it.Masked = acctMasked
		if strings.ToUpper(it.Provider) == "DANA" {
			it.Masked = phoneMasked
		}
		if it.Masked == "" {
			it.Masked = phoneMasked
		}
		candidates = append(candidates, domain.FreezeCandidate{ID: it.ID, CreatedAt: it.CreatedAt})
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	frozen := domain.FrozenAccountIDs(candidates, newPlan.MaxAccounts)
	conflict := &replaceConflict{
		OldPlanName: oldName, OldExpiresAt: oldExpires,
		NewPlanName: newPlan.Name, NewMaxAccounts: newPlan.MaxAccounts,
		NewPriceCents: newPlan.PriceCents, ConnectedCount: len(items),
		WouldFreeze: []replaceFreezeItem{},
	}
	for _, it := range items {
		if frozen[it.ID] {
			conflict.WouldFreeze = append(conflict.WouldFreeze, it)
		}
	}
	return conflict, nil
}

// requireReplaceConfirmation memeriksa paket aktif berbeda; bila ada
// dan confirmReplace false, menulis 409 active_subscription_exists dan
// mengembalikan ok=false (caller berhenti). Bila ok=true, conflict
// adalah paket lama yang ditemukan (nil bila tidak ada).
func (s *Server) requireReplaceConfirmation(w http.ResponseWriter, r *http.Request, memberID string, plan domain.Plan, confirmReplace bool) (*replaceConflict, bool) {
	conflict, err := s.loadReplaceConflict(r.Context(), memberID, plan)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa langganan aktif")
		return nil, false
	}
	if conflict != nil && !confirmReplace {
		writeReplaceConflict(w, conflict)
		return nil, false
	}
	return conflict, true
}

// cancelOldSubscriptionsTx membatalkan semua langganan aktif member
// kecuali keepSubID, DALAM transaksi yang sama dengan aktivasi paket
// baru. Mengembalikan nama paket lama yang dibatalkan (untuk audit);
// kosong bila tidak ada paket aktif lain.
func cancelOldSubscriptionsTx(ctx context.Context, tx *sql.Tx, memberID, keepSubID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT p.name FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.id<>?
		ORDER BY sub.expires_at DESC`, memberID, keepSubID)
	if err != nil {
		return nil, err
	}
	names := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE subscriptions SET status='cancelled'
		WHERE member_id=? AND status='active' AND id<>?`, memberID, keepSubID); err != nil {
		return nil, err
	}
	return names, nil
}

// insertAuditTx menulis satu baris audit_logs DALAM transaksi yang
// sama (s.audit / Store.Audit memakai koneksi DB di luar tx sehingga
// tidak bisa dipakai di sini). ip kosong: aktivasi lewat callback /
// klaim tidak membawa IP klien yang bermakna.
func insertAuditTx(ctx context.Context, tx *sql.Tx, actorType, actorID, action, detail string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO audit_logs (actor_type, actor_id, action, detail, ip)
		VALUES (?, ?, ?, ?, '')`, actorType, actorID, action, detail)
	return err
}

// subscriptionReplacedDetail merender detail audit subscription_replaced
// dengan gaya yang sama seperti audit admin ("paket: 'X' -> 'Y'").
func subscriptionReplacedDetail(oldNames []string, newPlanName string) string {
	return "paket: '" + strings.Join(oldNames, "', '") + "' -> '" + newPlanName + "'"
}

func (s *Server) handleCreateSubscription(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var req struct {
		PlanSlug       string `json:"plan_slug"`
		ConfirmReplace bool   `json:"confirm_replace"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	var plan domain.Plan
	var cb int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT id, slug, name, price_cents, duration_days,
		max_accounts, api_delay_minutes, notif_interval_minutes, callback_enabled
		FROM plans WHERE slug=? AND is_active=1`, req.PlanSlug).
		Scan(&plan.ID, &plan.Slug, &plan.Name, &plan.PriceCents, &plan.DurationDays, &plan.MaxAccounts,
			&plan.APIDelayMinutes, &plan.NotifIntervalMin, &cb)
	if err != nil {
		writeErr(w, http.StatusNotFound, "plan_not_found", "paket tidak ditemukan")
		return
	}
	plan.CallbackEnabled = cb == 1
	subID := newID()
	if plan.PriceCents == 0 {
		// Paket gratis (harga 0, mis. trial dari halaman langganan):
		// aktif langsung, tanpa pembayaran — TAPI hanya sekali.
		// Member yang sudah PERNAH punya subscription trial (apa pun
		// statusnya) tidak boleh mengklaim trial lagi. Cek ini jalan
		// duluan, sebelum cek ganti paket.
		var trialCount int
		_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM subscriptions sub
			JOIN plans p ON p.id=sub.plan_id
			WHERE sub.member_id=? AND p.slug='trial'`, id).Scan(&trialCount)
		if trialCount > 0 {
			writeErr(w, http.StatusConflict, "trial_already_used", "paket trial sudah pernah digunakan dan tidak bisa diklaim lagi")
			return
		}
		// Aturan konfirmasi yang sama seperti paket berbayar: paket
		// aktif berbeda harus dikonfirmasi dulu.
		if _, ok := s.requireReplaceConfirmation(w, r, id, plan, req.ConfirmReplace); !ok {
			return
		}
		// Cancel-old + aktivasi trial dalam SATU transaksi: batal
		// saat aktivasi, bukan saat order dibuat.
		tx, txErr := s.store.DB.BeginTx(r.Context(), nil)
		if txErr != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat langganan")
			return
		}
		defer tx.Rollback()
		oldNames, err := cancelOldSubscriptionsTx(r.Context(), tx, id, subID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal membatalkan paket lama")
			return
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO subscriptions
			(id, member_id, plan_id, status, starts_at, expires_at)
			VALUES (?, ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
			subID, id, plan.ID, plan.DurationDays); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat langganan")
			return
		}
		if len(oldNames) > 0 {
			if err := insertAuditTx(r.Context(), tx, "member", id, "subscription_replaced", subscriptionReplacedDetail(oldNames, plan.Name)); err != nil {
				writeErr(w, http.StatusInternalServerError, "db_error", "gagal mencatat penggantian paket")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat langganan")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"id": subID, "plan_slug": plan.Slug, "plan_name": plan.Name,
			"price_cents": plan.PriceCents, "status": "active",
			"message": "paket gratis diaktifkan",
		})
		return
	}
	// Paket berbayar: tolak bila sudah ada subscription pending/aktif
	// untuk member+plan yang sama (mencegah langganan ganda + order dobel).
	var existing int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM subscriptions
		WHERE member_id=? AND plan_id=? AND status IN ('pending','active')`, id, plan.ID).Scan(&existing)
	if existing > 0 {
		writeErr(w, http.StatusConflict, "already_pending", "sudah ada langganan pending atau aktif untuk paket ini")
		return
	}
	// Paket aktif BERBEDA: butuh confirm_replace=true; tanpa itu 409
	// active_subscription_exists. Pembatalan sendiri baru terjadi saat
	// aktivasi (callback paid), bukan saat order dibuat.
	if _, ok := s.requireReplaceConfirmation(w, r, id, plan, req.ConfirmReplace); !ok {
		return
	}
	_, err = s.store.DB.ExecContext(r.Context(), `INSERT INTO subscriptions (id, member_id, plan_id, status)
		VALUES (?, ?, ?, 'pending')`, subID, id, plan.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat langganan")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": subID, "plan_slug": plan.Slug, "plan_name": plan.Name,
		"price_cents": plan.PriceCents, "status": "pending",
		"message": "lanjutkan pembayaran untuk mengaktifkan langganan",
	})
}

func (s *Server) handlePayGobiz(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	subID := r.PathValue("id")
	// Kejujuran pembayaran: QRIS pembayaran belum aktif sampai kredensial
	// live terisi (GOBIZ_API_KEY) dan setting diaktifkan admin. Selama
	// salah satunya kosong, tolak dengan jelas — jangan membuat order
	// pending tanpa QRIS.
	gobizOn, _ := s.store.GetSetting(r.Context(), "gobiz_enabled")
	if gobizOn != "1" || strings.TrimSpace(s.cfg.GobizAPIKey) == "" {
		writeErr(w, http.StatusServiceUnavailable, "payment_unavailable",
			"pembayaran sedang nonaktif; hubungi admin untuk pembayaran manual")
		return
	}
	var planPrice int64
	var planDays int
	var planID int64
	var status string
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT p.price_cents, p.duration_days, p.id, sub.status
		FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
		WHERE sub.id=? AND sub.member_id=?`, subID, id).Scan(&planPrice, &planDays, &planID, &status)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "langganan tidak ditemukan")
		return
	}
	if status == "active" {
		writeErr(w, http.StatusConflict, "already_active", "langganan sudah aktif")
		return
	}
	// Tolak order dobel: sudah ada order pending untuk subscription ini,
	// atau subscription pending lain untuk member+plan yang sama.
	var pendingOrder int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM gobiz_orders
		WHERE subscription_id=? AND status='pending'`, subID).Scan(&pendingOrder)
	if pendingOrder > 0 {
		writeErr(w, http.StatusConflict, "already_pending", "sudah ada order pembayaran pending untuk langganan ini")
		return
	}
	var pendingSub int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM subscriptions
		WHERE member_id=? AND plan_id=? AND status='pending' AND id<>?`, id, planID, subID).Scan(&pendingSub)
	if pendingSub > 0 {
		writeErr(w, http.StatusConflict, "already_pending", "sudah ada langganan pending lain untuk paket ini")
		return
	}
	orderID := newID()
	// NOTE: real QRIS charge call is pending the official payment
	// provider API spec (endpoint + signature). The order is recorded
	// now; when the spec is available, the charge call goes here and
	// fills qr_url.
	_, err = s.store.DB.ExecContext(r.Context(), `INSERT INTO gobiz_orders
		(id, member_id, subscription_id, amount_cents, status, expires_at) VALUES (?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
		orderID, id, subID, planPrice)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat order pembayaran")
		return
	}
	// v37: email tagihan (pending) ke member — fail-open, order tetap
	// dibuat walau email gagal terkirim.
	if planName, memberEmail, _, err := s.subscriptionMailInfo(r.Context(), subID); err == nil {
		s.sendOrderPendingEmail(r.Context(), id, memberEmail, planName, orderID, planPrice)
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"order_id": orderID, "subscription_id": subID, "amount_cents": planPrice,
		"status":  "pending",
		"message": "order pembayaran dibuat; kode QRIS akan tersedia setelah integrasi pembayaran diaktifkan penuh",
	})
}

// activateSubscriptionTx menandai order paid DAN mengaktifkan langganan
// dalam SATU transaksi: gagal di salah satu = keduanya batal, sehingga
// tidak pernah ada order paid tanpa langganan aktif (atau sebaliknya).
// v30: sebelum mengaktifkan yang baru, semua langganan aktif lain
// member itu dibatalkan (cancel-old) dalam transaksi yang sama — satu
// member maksimal 1 paket aktif. Bila ada paket lama yang dibatalkan,
// ditulis audit subscription_replaced (langsung via SQL dalam tx,
// karena s.audit memakai koneksi di luar transaksi).
func (s *Server) activateSubscriptionTx(ctx context.Context, orderID, subID string, planDays int) error {
	tx, err := s.store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var memberID, newPlanName string
	if err := tx.QueryRowContext(ctx, `SELECT sub.member_id, p.name FROM subscriptions sub
		JOIN plans p ON p.id=sub.plan_id WHERE sub.id=?`, subID).Scan(&memberID, &newPlanName); err != nil {
		return err
	}
	oldNames, err := cancelOldSubscriptionsTx(ctx, tx, memberID, subID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE gobiz_orders SET status='paid' WHERE id=?`, orderID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE subscriptions SET status='active', starts_at=NOW(),
		expires_at=DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id=?`, planDays, subID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	if len(oldNames) > 0 {
		if err := insertAuditTx(ctx, tx, "member", memberID, "subscription_replaced", subscriptionReplacedDetail(oldNames, newPlanName)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// subscriptionMailInfo mengambil data yang dibutuhkan email tagihan:
// nama paket, email member, dan expires_at langganan.
func (s *Server) subscriptionMailInfo(ctx context.Context, subID string) (planName, memberEmail string, expiresAt time.Time, err error) {
	var memberID string
	var exp sql.NullTime
	err = s.store.DB.QueryRowContext(ctx, `SELECT sub.member_id, m.email, p.name, sub.expires_at
		FROM subscriptions sub JOIN members m ON m.id=sub.member_id
		JOIN plans p ON p.id=sub.plan_id WHERE sub.id=?`, subID).
		Scan(&memberID, &memberEmail, &planName, &exp)
	if err != nil {
		return "", "", time.Time{}, err
	}
	if exp.Valid {
		expiresAt = exp.Time
	}
	return planName, memberEmail, expiresAt, nil
}

// sendPaidEmailForSubscription mengirim email "pembayaran berhasil"
// setelah aktivasi. Fail-open: dipakai di jalur callback Gobiz.
func (s *Server) sendPaidEmailForSubscription(ctx context.Context, subID, orderID string) {
	planName, memberEmail, expiresAt, err := s.subscriptionMailInfo(ctx, subID)
	if err != nil {
		s.log.Printf("http: gobiz callback: info email langganan %s gagal: %v", subID, err)
		return
	}
	var memberID string
	_ = s.store.DB.QueryRowContext(ctx, `SELECT member_id FROM subscriptions WHERE id=?`, subID).Scan(&memberID)
	s.sendOrderPaidEmail(ctx, memberID, memberEmail, planName, orderID, expiresAt)
}

// verifyGobizOrderStatus re-verifies an order's paid status with the
// payment provider before any subscription is activated (P2-24).
// Fail-closed: there is NO Gobiz status-check client yet (no official
// endpoint/spec for order status in the codebase), so verification is
// currently impossible — the callback must NOT activate anything and
// answers 503. When a Gobiz order-status client exists, implement the
// real check here (GET order status with the API key) and return nil
// only when the provider itself reports the order paid.
func (s *Server) verifyGobizOrderStatus(ctx context.Context, orderID string) error {
	if strings.TrimSpace(s.cfg.GobizAPIKey) == "" {
		return fmt.Errorf("gobiz api key belum dikonfigurasi")
	}
	return fmt.Errorf("verifikasi status order ke penyedia pembayaran belum tersedia (tidak ada klien status order)")
}

func (s *Server) handleGobizCallback(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var body struct {
		OrderID string `json:"order_id"`
		Status  string `json:"status"`
		Secret  string `json:"webhook_secret"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	// Fail-closed: tanpa secret yang dikonfigurasi, webhook tidak bisa
	// diautentikasi — siapa pun bisa mengaktifkan langganan gratis.
	if s.cfg.GobizWebhookSecret == "" {
		writeErr(w, http.StatusUnauthorized, "webhook_not_configured", "webhook pembayaran belum dikonfigurasi")
		return
	}
	got := r.Header.Get("X-Gobiz-Secret")
	if got == "" {
		got = body.Secret
	}
	// P2-24: komparasi secret constant-time (hmac.Equal), bukan `==`.
	if !hmac.Equal([]byte(got), []byte(s.cfg.GobizWebhookSecret)) {
		writeErr(w, http.StatusUnauthorized, "invalid_signature", "webhook secret tidak cocok")
		return
	}
	status := strings.ToLower(strings.TrimSpace(body.Status))
	switch status {
	case "paid", "success", "failed", "expired", "cancelled":
		// Status yang dikenal — lanjut di bawah.
	default:
		writeErr(w, http.StatusBadRequest, "invalid_status", "status webhook tidak dikenal: "+body.Status)
		return
	}
	var subID string
	var planDays int
	var orderStatus, subStatus string
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT go.subscription_id, p.duration_days, go.status, sub.status
		FROM gobiz_orders go JOIN subscriptions sub ON sub.id=go.subscription_id
		JOIN plans p ON p.id=sub.plan_id WHERE go.id=?`, body.OrderID).Scan(&subID, &planDays, &orderStatus, &subStatus)
	if err != nil {
		writeErr(w, http.StatusNotFound, "order_not_found", "order tidak ditemukan")
		return
	}
	// Idempotent: order yang sudah paid tidak boleh memperpanjang
	// expires_at lewat replay callback. Tapi bila langganannya masih
	// pending (aktivasi dulu gagal di tengah jalan), perbaiki di sini
	// dalam transaksi yang sama — replay menjadi jalan pemulihan.
	// P2-24: aktivasi (termasuk perbaikan replay) HANYA setelah status
	// order terverifikasi ulang ke penyedia; klaim webhook saja tidak
	// cukup. P1-4 (atomicity via activateSubscriptionTx) tidak diubah.
	if orderStatus == "paid" {
		if subStatus == "pending" {
			if err := s.verifyGobizOrderStatus(r.Context(), body.OrderID); err != nil {
				s.log.Printf("http: gobiz callback: verifikasi order %s gagal: %v", body.OrderID, err)
				writeErr(w, http.StatusServiceUnavailable, "provider_error", "status pembayaran belum bisa diverifikasi, coba lagi nanti")
				return
			}
			if err := s.activateSubscriptionTx(r.Context(), body.OrderID, subID, planDays); err != nil {
				writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan langganan")
				return
			}
			// v37: email pembayaran berhasil (fail-open).
			s.sendPaidEmailForSubscription(r.Context(), subID, body.OrderID)
			writeJSON(w, http.StatusOK, map[string]any{"message": "langganan diaktifkan"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"message": "already_paid"})
		return
	}
	if status != "paid" && status != "success" {
		_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE gobiz_orders SET status=? WHERE id=?`, status, body.OrderID)
		writeJSON(w, http.StatusOK, map[string]any{"message": "status order diperbarui: " + status})
		return
	}
	// Aktivasi hanya bila order masih pending DAN status terverifikasi.
	if orderStatus != "pending" {
		writeErr(w, http.StatusConflict, "order_not_pending", "order tidak dalam status pending")
		return
	}
	if err := s.verifyGobizOrderStatus(r.Context(), body.OrderID); err != nil {
		s.log.Printf("http: gobiz callback: verifikasi order %s gagal: %v", body.OrderID, err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "status pembayaran belum bisa diverifikasi, coba lagi nanti")
		return
	}
	if err := s.activateSubscriptionTx(r.Context(), body.OrderID, subID, planDays); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan langganan")
		return
	}
	// v37: email pembayaran berhasil (fail-open).
	s.sendPaidEmailForSubscription(r.Context(), subID, body.OrderID)
	writeJSON(w, http.StatusOK, map[string]any{"message": "langganan diaktifkan"})
}

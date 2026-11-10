package http

import (
	"context"
	"crypto/hmac"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mutasi-hub/internal/crypto"
	syncpkg "mutasi-hub/internal/sync"
)

// handleConnectaWebhook receives Connecta callbacks:
//   - DANA binding completion (status pending -> active)
//   - DANA transaction notifications (stored as mutations, deduped)
//
// If CONNECTA_WEBHOOK_SECRET is set, the request must carry it in the
// X-Webhook-Secret header (or the JSON body field "secret").
func (s *Server) handleConnectaWebhook(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var body struct {
		Event       string `json:"event"`
		Type        string `json:"type"`
		Secret      string `json:"secret"`
		Phone       string `json:"phone"`
		ClientRef   string `json:"client_ref"`
		Status      string `json:"status"`
		AccountID   string `json:"account_id"`
		AccountNo   string `json:"account_no"`
		Date        string `json:"date"`
		Amount      int64  `json:"amount"`
		Description string `json:"description"`
		Sender      string `json:"sender"`
		TxType      string `json:"tx_type"`
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	// P2-23: body gagal parse -> 400 invalid_json SEBELUM cek secret
	// (dulu 401 yang menyesatkan karena Unmarshal gagal diabaikan).
	// Keterbatasan (dicatat): Connecta memakai shared secret
	// (header/body), BUKAN HMAC atas body + timestamp — tidak ada
	// verifikasi HMAC yang bisa dipaksakan di sisi kita.
	if err := json.Unmarshal(raw, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json", "body webhook tidak valid")
		return
	}
	// Fail-closed: tanpa secret yang dikonfigurasi, webhook tidak bisa
	// diautentikasi — tolak semuanya, jangan terima begitu saja.
	if s.cfg.ConnectaWebhookSecret == "" {
		writeErr(w, http.StatusUnauthorized, "webhook_not_configured", "webhook belum dikonfigurasi")
		return
	}
	got := r.Header.Get("X-Webhook-Secret")
	if got == "" {
		got = body.Secret
	}
	if !hmac.Equal([]byte(got), []byte(s.cfg.ConnectaWebhookSecret)) {
		writeErr(w, http.StatusUnauthorized, "invalid_signature", "webhook secret tidak cocok")
		return
	}
	event := body.Event
	if event == "" {
		event = body.Type
	}
	ctx := r.Context()
	switch {
	case strings.Contains(event, "binding"):
		// DANA binding completed: activate the linked account — but
		// ONLY on a known-success status (P1-9). The Connecta contract
		// (Postman collection) does not document webhook payloads at
		// all, so the allowlist in isBindingSuccessStatus is a
		// conservative guess; a failed/cancelled event, or one with no
		// status, must never activate an account. A missed activation
		// self-heals: syncDANA re-checks binding via danaBound and
		// activates pending accounts on the next poll.
		if isBindingSuccessStatus(body.Status) {
			if body.ClientRef != "" && body.Phone != "" {
				if accountID, ok := s.findDANAAccount(ctx, body.ClientRef, body.Phone, "", "pending"); ok {
					// v34: catat tanggal otorisasi pertama; COALESCE menjaga
					// tanggal pertama bila otorisasi diulang.
					_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET status='active', authorized_at=COALESCE(authorized_at, NOW()) WHERE id=?`, accountID)
				} else {
					s.log.Printf("webhook: dana binding client_ref=%s: nomor tidak cocok dengan akun DANA pending mana pun, tidak diaktifkan", body.ClientRef)
				}
			} else {
				s.log.Printf("webhook: dana binding event=%s client_ref=%s status=%s: client_ref/phone kosong, tidak diaktifkan", event, body.ClientRef, body.Status)
			}
		} else {
			s.log.Printf("webhook: dana binding event=%s client_ref=%s status=%s: bukan status sukses, tidak diaktifkan", event, body.ClientRef, body.Status)
		}
		s.log.Printf("webhook: dana binding event=%s client_ref=%s status=%s", event, body.ClientRef, body.Status)
	case strings.Contains(event, "transaction") || strings.Contains(event, "mutation"):
		// Amount 0 bukan mutasi: tolak diam-diam (bukan error).
		if body.Amount == 0 {
			s.log.Printf("webhook: dana transaction client_ref=%s: amount 0, dilewati", body.ClientRef)
			break
		}
		phone := body.Phone
		if phone == "" {
			phone = body.AccountNo
		}
		typ := body.TxType
		if typ == "" {
			typ = "CR"
		}
		// Tanggal gagal parse = baris ditolak, jangan pakai time.Now().
		date, ok := parseWebhookTxDate(body.Date)
		if !ok {
			s.log.Printf("webhook: dana transaction client_ref=%s: tanggal %q tak ter-parse, dilewati", body.ClientRef, body.Date)
			break
		}
		// Resolve akun dengan mencocokkan nomor LENGKAP dari payload
		// dengan linked_accounts milik member (client_ref = member_id);
		// hanya akun berstatus active yang boleh menerima mutasi —
		// akun pending tidak pernah mendapat mutasi lewat webhook.
		var accountID string
		if body.ClientRef != "" {
			accountID, _ = s.findDANAAccount(ctx, body.ClientRef, phone, body.AccountNo, "active")
		}
		if accountID != "" {
			hash := syncpkg.MutationHash(body.ClientRef, accountID, "DANA", date, typ, body.Amount, body.Description)
			_, _ = s.store.DB.ExecContext(ctx, `INSERT IGNORE INTO mutations
				(member_id, linked_account_id, provider, tx_date, type, amount_cents, description, sender, dedup_hash)
				VALUES (?, ?, 'DANA', ?, ?, ?, ?, ?, ?)`,
				body.ClientRef, accountID, date, typ, body.Amount, body.Description, body.Sender, hash)
			s.log.Printf("webhook: dana transaction member=%s amount=%d", body.ClientRef, body.Amount)
		} else {
			s.log.Printf("webhook: dana transaction client_ref=%s: tidak ada akun DANA aktif yang cocok dengan nomor payload, dilewati", body.ClientRef)
		}
	default:
		s.log.Printf("webhook: unknown connecta event %q (stored as audit)", event)
	}
	// Audit hanya field aman — JANGAN simpan raw body: bisa berisi secret/token.
	safeDetail := fmt.Sprintf("event=%s client_ref=%s status=%s", event, body.ClientRef, body.Status)
	s.store.Audit(ctx, "connecta", body.ClientRef, "webhook:"+event, safeDetail, clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"message": "ok"})
}

// isBindingSuccessStatus — allowlist konservatif nilai status sukses
// webhook binding Connecta. Kontrak resmi (koleksi Postman
// Connecta_B2B_Partner_API) TIDAK mendokumentasikan payload webhook
// sama sekali: tidak ada contoh event, tidak ada nilai status. Nilai
// yang dipilih ("success", "completed", "bound", "active", tanpa
// membedakan huruf besar/kecil) adalah tebakan konservatif; status lain
// — termasuk status kosong — diperlakukan sebagai bukan-sukses dan
// TIDAK mengaktifkan apa pun. RISIKO: bila Connecta mengirim nilai
// sukses lain (mis. "linked", "verified", "done") atau tanpa field
// status, binding sah tidak aktif via webhook; mitigasinya adalah
// jaring pengaman syncDANA (danaBound) yang mengaktifkan akun pending
// yang terverifikasi ter-binding pada poll berikutnya. Bila nilai status
// asli Connecta sudah diketahui dari payload nyata, sesuaikan allowlist
// ini — jangan longgarkan menjadi "selain gagal".
func isBindingSuccessStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success", "completed", "bound", "active":
		return true
	}
	return false
}

// parseWebhookTxDate mem-parse tanggal transaksi webhook dengan aturan
// yang sama seperti sync.parseTxDate: RFC3339 (dengan offset) apa
// adanya, layout naif dibaca sebagai WIB. False = tanggal tak ter-parse
// (termasuk kosong): pemanggil harus melewati baris itu, jangan pakai
// time.Now().
func parseWebhookTxDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	wib := time.FixedZone("WIB", 7*3600)
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, wib); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// normalizePhoneID menyamakan penulisan nomor HP untuk perbandingan:
// hanya digit, awalan "62" diubah ke "0".
func normalizePhoneID(v string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, strings.TrimSpace(v))
	if strings.HasPrefix(digits, "62") {
		return "0" + digits[2:]
	}
	return digits
}

// findDANAAccount mencocokkan SATU rekening DANA milik member dengan
// nomor LENGKAP dari payload (phone dan/atau account_no), pada status
// yang diminta ("pending" untuk binding, "active" untuk transaksi).
// Nomor lengkap hanya tersimpan di dalam credential terenkripsi, jadi
// kandidat didekripsi lalu dibandingkan persis setelah normalisasi.
// Bila kunci enkripsi tidak tersedia, fallback membandingkan bentuk
// ter-mask (4 digit awal + 2 digit akhir) — lebih lemah, hanya jalan
// darurat. TIDAK PERNAH memakai prefix LIKE: dua nomor berawalan sama
// milik member yang sama tidak boleh tertukar.
//
// CATATAN: field account_id dari payload Connecta TIDAK dipakai untuk
// pencocokan — id itu milik Connecta, sedangkan linked_accounts.id
// adalah UUID internal kami, jadi tidak ada kolom yang bisa dicocokkan
// persis dengannya.
func (s *Server) findDANAAccount(ctx context.Context, memberID, phone, accountNo, status string) (string, bool) {
	wantPhone := normalizePhoneID(phone)
	wantAcct := normalizePhoneID(accountNo)
	if wantPhone == "" && wantAcct == "" {
		return "", false
	}
	rows, err := s.store.DB.QueryContext(ctx, `SELECT id, phone_masked, credential_ciphertext FROM linked_accounts
		WHERE member_id=? AND provider='DANA' AND status=?`, memberID, status)
	if err != nil {
		s.log.Printf("webhook: find dana account: %v", err)
		return "", false
	}
	defer rows.Close()
	for rows.Next() {
		var id, phoneMasked string
		var cred sql.NullString
		if err := rows.Scan(&id, &phoneMasked, &cred); err != nil {
			continue
		}
		if len(s.encKey) > 0 && cred.Valid && cred.String != "" {
			plain, err := crypto.Decrypt(s.encKey, cred.String)
			if err == nil {
				var c struct {
					Phone     string `json:"phone"`
					AccountNo string `json:"account_no"`
				}
				if json.Unmarshal([]byte(plain), &c) == nil {
					storedPhone := normalizePhoneID(c.Phone)
					storedAcct := normalizePhoneID(c.AccountNo)
					if (wantPhone != "" && storedPhone != "" && storedPhone == wantPhone) ||
						(wantAcct != "" && ((storedAcct != "" && storedAcct == wantAcct) || (storedPhone != "" && storedPhone == wantAcct))) {
						return id, true
					}
				}
			}
			continue
		}
		// Fallback tanpa kunci enkripsi: bandingkan bentuk ter-mask.
		// Hanya untuk nomor yang cukup panjang agar "****" tidak
		// pernah cocok palsu.
		if wantPhone != "" && len(wantPhone) >= 9 && phoneMasked != "" && crypto.MaskPhone(wantPhone) == phoneMasked {
			return id, true
		}
	}
	return "", false
}

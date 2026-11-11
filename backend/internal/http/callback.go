// Instant Callback member endpoints (v42a).
//
// PUT /api/v1/member/callback — simpan/hapus callback_url.
// POST /api/v1/member/callback/test — kirim event callback.test.
// POST /api/v1/member/callback/secret/regenerate — secret HMAC baru.
// GET /api/v1/member/callback/deliveries — riwayat pengiriman.
//
// Gate paket (Q6): isi URL + tes hanya bila paket aktif member
// callback_enabled=1 (Enterprise) — selain itu 403
// callback_not_available. Hapus URL selalu diizinkan (member yang turun
// paket tetap bisa menonaktifkan). Q7: URL wajib https + lolos SSRF
// guard (sync.ValidateCallbackURL).
package http

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	syncpkg "mutasi-hub/internal/sync"
)

// callbackTestThrottleWindow: maks 1 tes/menit/member (v42a).
const callbackTestThrottleWindow = time.Minute

// callbackTestThrottled reports whether a test sent at last may not be
// repeated yet (pure, unit-testable).
func callbackTestThrottled(last, now time.Time) bool {
	return now.Sub(last) < callbackTestThrottleWindow
}

// truncateBody shortens a response body for display (maks 500 karakter).
func truncateBody(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// parseDeliveriesPage parses ?page=&page_size= for the deliveries list:
// page default 1 (min 1), page_size default 20, maks 50 (pure,
// unit-testable).
func parseDeliveriesPage(pageStr, sizeStr string) (page, size int) {
	page, size = 1, 20
	if p, err := strconv.Atoi(pageStr); err == nil && p >= 1 {
		page = p
	}
	if n, err := strconv.Atoi(sizeStr); err == nil && n >= 1 {
		size = n
	}
	if size > 50 {
		size = 50
	}
	return page, size
}

// handleSetMemberCallback — PUT /api/v1/member/callback.
// Req {callback_url: string} — string kosong = hapus/nonaktifkan.
// Resp 200 {callback_url, callback_enabled, message}.
// Err: 400 invalid_callback_url, 403 callback_not_available.
func (s *Server) handleSetMemberCallback(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var req struct {
		CallbackURL string `json:"callback_url"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	url := strings.TrimSpace(req.CallbackURL)
	enabled, err := s.syncer.CallbackAvailable(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa paket")
		return
	}
	if url == "" {
		// Hapus: selalu diizinkan — member yang turun paket tetap bisa
		// menonaktifkan callback-nya.
		if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET callback_url=NULL WHERE id=?`, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghapus URL callback")
			return
		}
		s.audit(r, "member", id, "callback_url_removed", "URL callback dihapus member")
		writeJSON(w, http.StatusOK, map[string]any{
			"callback_url": "", "callback_enabled": enabled, "message": "URL callback dihapus",
		})
		return
	}
	if !enabled {
		writeErr(w, http.StatusForbidden, "callback_not_available", "Instant Callback hanya tersedia di paket Enterprise")
		return
	}
	if err := syncpkg.ValidateCallbackURL(r.Context(), url); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_callback_url", "URL callback tidak valid: "+err.Error())
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET callback_url=? WHERE id=?`, url, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan URL callback")
		return
	}
	s.audit(r, "member", id, "callback_url_set", "URL callback diubah member")
	writeJSON(w, http.StatusOK, map[string]any{
		"callback_url": url, "callback_enabled": true, "message": "URL callback disimpan",
	})
}

// handleTestMemberCallback — POST /api/v1/member/callback/test.
// Resp 200 {event: "callback.test", status_code, response_body} bila
// endpoint menjawab 2xx; 502 callback_test_failed bila tidak.
// Throttle 429 callback_test_throttled (maks 1 tes/menit/member).
func (s *Server) handleTestMemberCallback(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var last sql.NullTime
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT MAX(created_at) FROM callbacks
		WHERE member_id=? AND event='callback.test'`, id).Scan(&last)
	if last.Valid && callbackTestThrottled(last.Time, time.Now()) {
		writeErr(w, http.StatusTooManyRequests, "callback_test_throttled", "tunggu sebentar sebelum mengirim tes callback lagi (maks 1 per menit)")
		return
	}
	status, body, err := s.syncer.TestCallback(r.Context(), id)
	if err != nil {
		switch {
		case errors.Is(err, syncpkg.ErrCallbackNotAvailable):
			writeErr(w, http.StatusForbidden, "callback_not_available", "Instant Callback hanya tersedia di paket Enterprise")
			return
		case errors.Is(err, syncpkg.ErrCallbackNoURL):
			writeErr(w, http.StatusBadRequest, "callback_not_configured", "isi URL callback dulu sebelum mengirim tes")
			return
		case errors.Is(err, syncpkg.ErrCallbackURLInvalid):
			// Target ditolak SSRF guard saat fire (DNS berubah setelah
			// URL disimpan) — bukan salah server.
			writeErr(w, http.StatusBadRequest, "invalid_callback_url", "URL callback tidak valid: "+err.Error())
			return
		}
		// Gagal kirim (transport/non-2xx setelah 3 percobaan): TestCallback
		// mengembalikan err non-nil + status/body percobaan terakhir.
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "callback_test_failed", "message": "tes callback gagal: endpoint tidak menjawab 2xx",
			"event": "callback.test", "status_code": status, "response_body": truncateBody(body, 500),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"event": "callback.test", "status_code": status, "response_body": truncateBody(body, 500),
	})
}

// handleRegenerateCallbackSecret — POST /api/v1/member/callback/secret/regenerate.
// Resp 200 {callback_secret} — plaintext tampil SEKALI. Secret lama
// langsung tidak berlaku: endpoint member yang memverifikasi dengan
// secret lama akan gagal sampai diperbarui.
func (s *Server) handleRegenerateCallbackSecret(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat secret baru")
		return
	}
	secret := hex.EncodeToString(b)
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET callback_secret=? WHERE id=?`, secret, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan secret baru")
		return
	}
	s.audit(r, "member", id, "callback_secret_regenerated", "secret callback dibuat ulang member")
	writeJSON(w, http.StatusOK, map[string]any{"callback_secret": secret})
}

// callbackDelivery is one row of the deliveries list.
type callbackDelivery struct {
	Event        string `json:"event"`
	TargetURL    string `json:"target_url"`
	StatusCode   int    `json:"status_code"`
	ResponseBody string `json:"response_body"`
	CreatedAt    string `json:"created_at"`
}

// handleListCallbackDeliveries — GET /api/v1/member/callback/deliveries.
// Resp {deliveries, page, page_size, total_count}; 20 terakhir default,
// page_size maks 50. response_body dipotong 500 karakter.
func (s *Server) handleListCallbackDeliveries(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	page, size := parseDeliveriesPage(r.URL.Query().Get("page"), r.URL.Query().Get("page_size"))
	offset := (page - 1) * size
	var total int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM callbacks WHERE member_id=?`, id).Scan(&total)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT event, target_url, status_code,
		LEFT(response_body, 500), created_at FROM callbacks
		WHERE member_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, id, size, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca riwayat callback")
		return
	}
	defer rows.Close()
	out := []callbackDelivery{}
	for rows.Next() {
		var d callbackDelivery
		var created time.Time
		if err := rows.Scan(&d.Event, &d.TargetURL, &d.StatusCode, &d.ResponseBody, &created); err != nil {
			continue
		}
		d.CreatedAt = formatWIB(created)
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"deliveries": out, "page": page, "page_size": size, "total_count": total,
	})
}

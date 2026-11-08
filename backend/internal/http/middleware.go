package http

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"mutasi-hub/internal/auth"
)

// newSessionToken signs a session token with the caller-supplied
// secret. The secret MUST come from Server.jwtSecret() (P2-18): the
// same value is used for signing and validation, including the
// once-per-process fallback when JWT_SECRET is empty. Never generate a
// fresh random secret here — that made sessions unverifiable.
func newSessionToken(secret, subject, role string, sv int) (string, error) {
	return auth.NewJWTWithVersion(secret, subject, role, sv, 24*time.Hour)
}

func withValue(r *http.Request, k ctxKey, v string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), k, v))
}

// checkMemberAccess adalah SATU-SATUNYA tempat penegakan status member
// untuk sesi (P1-1): disabled → 403 account_disabled, must_change_password
// → 403 must_change_password (kecuali bila enforceMustChange=false,
// dipakai authMember untuk jalur yang dikecualikan), dan sv token != sv
// di DB → 401 (P1-2, sesi dicabut lewat bump session_version).
// Mengembalikan status HTTP 0 bila lolos; bila DB tidak tersedia atau
// query gagal, lolos (fail-open seperti perilaku lama — handler yang
// butuh DB akan gagal sendiri).
func (s *Server) checkMemberAccess(r *http.Request, memberID string, tokenSV int, enforceMustChange bool) (status int, code, msg string) {
	if !s.store.Available() {
		return 0, "", ""
	}
	var st string
	var mustChange int
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(status,'active'), COALESCE(must_change_password,0) FROM members WHERE id=?`, memberID).Scan(&st, &mustChange); err != nil {
		return 0, "", ""
	}
	if st == "disabled" {
		return http.StatusForbidden, "account_disabled", "akun dinonaktifkan oleh admin"
	}
	if mustChange == 1 && enforceMustChange {
		return http.StatusForbidden, "must_change_password", "kata sandi Anda direset admin, silakan ganti kata sandi baru dulu"
	}
	var sv int
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(session_version,0) FROM members WHERE id=?`, memberID).Scan(&sv); err == nil && sv != tokenSV {
		return http.StatusUnauthorized, "unauthorized", "sesi sudah tidak berlaku, silakan login kembali"
	}
	return 0, "", ""
}

// hasActiveSubscription melaporkan apakah member punya subscription
// aktif yang belum kedaluwarsa (P1-7). Hanya dipakai di authenticateMutasi
// (/mutasi) — TIDAK di authMember global, agar endpoint langganan,
// pembayaran, me, change-password, dan logout tetap bisa diakses member
// yang paketnya kedaluwarsa.
// Tanpa DB -> false (fail-closed 403), BUKAN panic nil *sql.DB — jalur
// ini tercapai oleh sesi valid bahkan saat DB mati.
func (s *Server) hasActiveSubscription(r *http.Request, memberID string) bool {
	if !s.store.Available() {
		return false
	}
	var n int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM subscriptions
		WHERE member_id=? AND status='active' AND expires_at > NOW()`, memberID).Scan(&n)
	return err == nil && n > 0
}

// apiKeyHasScope melaporkan apakah scope API key (comma-separated, atau
// "all" sebagai default saat key dibuat tanpa scope — lihat
// handleCreateAPIKey) mengizinkan scope yang diminta (P1-12).
// Nilai scope yang dipakai UI member: "mutasi:read", "accounts:read",
// "webhook:receive" (frontend/app/member/api/page.tsx).
func apiKeyHasScope(scope, want string) bool {
	for _, part := range strings.Split(scope, ",") {
		p := strings.TrimSpace(part)
		if p == "all" || p == want {
			return true
		}
	}
	return false
}

// validSessionClaims mengembalikan klaim sesi pertama yang VALID dengan
// salah satu peran yang diminta, dengan mencoba SEMUA cookie mh_session
// di request — bukan hanya yang pertama (r.Cookie mengembalikan cookie
// pertama dengan nama itu).
//
// Latar (bug 8 Nov 2026): sebelum v22 cookie sesi dipasang dengan
// Domain=.rajacek.com; sejak v22 host-only. Browser menyimpan keduanya
// sebagai cookie BERBEDA (scope domain berbeda) dan mengirim keduanya —
// yang lama (dibuat lebih dulu) di depan (RFC 6265 §5.4). Bila cookie
// lama itu token admin / token kedaluwarsa, r.Cookie() mengembalikannya,
// validasi gagal, dan member yang BARU SAJA login sukses langsung
// terpental ke /login (<1 detik) — walau token member yang sah ada tepat
// di belakangnya di header yang sama. Gejala persis yang dilaporkan:
// POST /auth/login 200 lalu semua /api/v1/* 401 di detik yang sama.
// Terbukti live: "mh_session=<sampah>; mh_session=<valid>" -> 401,
// urutan dibalik -> 200.
func (s *Server) validSessionClaims(r *http.Request, roles ...string) (*auth.Claims, bool) {
	for _, c := range r.Cookies() {
		if c.Name != "mh_session" {
			continue
		}
		claims, err := auth.ValidateJWT(s.jwtSecret(), c.Value)
		if err != nil {
			continue
		}
		for _, role := range roles {
			if claims.Role == role {
				return claims, true
			}
		}
	}
	return nil, false
}

// authMember requires a valid member JWT session cookie.
func (s *Server) authMember(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := s.validSessionClaims(r, "member")
		if !ok {
			if _, err := r.Cookie("mh_session"); err != nil {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi tidak ditemukan, silakan login")
			} else {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi tidak valid atau kedaluwarsa")
			}
			return
		}
		// Flag wajib ganti kata sandi (v20, opsi A): bila must_change_password
		// = 1, semua endpoint member diblok 403 must_change_password KECUALI
		// ganti sandi, logout, dan me — jadi member tidak bisa memakai fitur
		// apa pun sebelum mengganti sandi reset dari admin.
		if status, code, msg := s.checkMemberAccess(r, claims.Subject, claims.SessionVersion, !isPasswordChangeExempt(r)); status != 0 {
			writeErr(w, status, code, msg)
			return
		}
		// Sliding refresh (P2-18): perpanjang TTL bila sisa < 12 jam.
		s.maybeRefreshSession(w, claims)
		next(w, withValue(r, ctxMemberID, claims.Subject))
	}
}

// isPasswordChangeExempt reports whether a member request may proceed while
// must_change_password=1: only changing the password, logging out, or
// reading the profile (which carries the flag for the frontend).
func isPasswordChangeExempt(r *http.Request) bool {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/change-password":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/logout":
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/auth/me":
		return true
	default:
		return false
	}
}

// authAdmin requires a valid admin JWT session cookie.
func (s *Server) authAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := s.validSessionClaims(r, "admin")
		if !ok {
			if _, err := r.Cookie("mh_session"); err != nil {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi admin tidak ditemukan")
			} else {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi admin tidak valid")
			}
			return
		}
		// Revokasi sesi admin (P1-2): sv token != sv di DB → sesi mati.
		// Bila kolom/query gagal dibaca, lolos (fail-open seperti member).
		if s.store.Available() {
			var sv int
			if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(session_version,0) FROM admin_users WHERE id=?`, claims.Subject).Scan(&sv); err == nil && sv != claims.SessionVersion {
				writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi admin sudah tidak berlaku, silakan login kembali")
				return
			}
		}
		s.maybeRefreshSession(w, claims)
		next(w, withValue(r, ctxAdminID, claims.Subject))
	}
}

// authenticateMutasi resolves the caller of GET /mutasi: an API key
// (X-API-Key header, with IP whitelist + rate limit) or a member
// session cookie. Returns memberID or writes the error.
func (s *Server) authenticateMutasi(w http.ResponseWriter, r *http.Request) (string, bool) {
	if key := strings.TrimSpace(r.Header.Get("X-API-Key")); key != "" {
		if !s.requireDB(w) {
			return "", false
		}
		hash := sha256Hex(key)
		var memberID, scope, ipList string
		var active int
		var keyExpires sql.NullTime
		err := s.store.DB.QueryRowContext(r.Context(), `SELECT member_id, scope, COALESCE(ip_whitelist,''), is_active, expires_at
			FROM api_keys WHERE key_hash=?`, hash).Scan(&memberID, &scope, &ipList, &active, &keyExpires)
		if err != nil || active != 1 {
			writeErr(w, http.StatusUnauthorized, "invalid_api_key", "API key tidak valid atau nonaktif")
			return "", false
		}
		// P2-22: key kedaluwarsa ditolak dengan kode berbeda (401).
		if keyExpires.Valid && time.Now().After(keyExpires.Time) {
			writeErr(w, http.StatusUnauthorized, "api_key_expired", "API key sudah kedaluwarsa")
			return "", false
		}
		if ipList != "" {
			ip := clientIP(r)
			allowed := false
			for _, allow := range strings.Split(ipList, ",") {
				if strings.TrimSpace(allow) == ip {
					allowed = true
					break
				}
			}
			if !allowed {
				writeErr(w, http.StatusForbidden, "ip_not_allowed", "IP tidak ada di whitelist API key ini")
				return "", false
			}
		}
		// Rate limit: 60/min default; delay-0 (Enterprise) plans get 300/min.
		rate := 60.0
		var delay int
		if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(p.api_delay_minutes, 5) FROM subscriptions sub
			JOIN plans p ON p.id = sub.plan_id
			WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() LIMIT 1`, memberID).Scan(&delay); err == nil && delay == 0 {
			rate = 300
		}
		if !s.limiter.Allow("apikey:"+hash, rate) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak permintaan, coba lagi sebentar lagi")
			return "", false
		}
		// Scope (P1-12): /mutasi hanya untuk key "all" atau "mutasi:read".
		if !apiKeyHasScope(scope, "mutasi:read") {
			writeErr(w, http.StatusForbidden, "insufficient_scope", "API key ini tidak punya scope mutasi:read")
			return "", false
		}
		// Akun yang dinonaktifkan admin: API key-nya ikut mati.
		// Wajib ganti sandi (P1-1): key juga diblok sampai sandi diganti.
		var mst string
		var mustChange int
		if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(status,'active'), COALESCE(must_change_password,0) FROM members WHERE id=?`, memberID).Scan(&mst, &mustChange); err == nil {
			if mst == "disabled" {
				writeErr(w, http.StatusUnauthorized, "invalid_api_key", "API key tidak valid atau nonaktif")
				return "", false
			}
			if mustChange == 1 {
				writeErr(w, http.StatusForbidden, "must_change_password", "kata sandi Anda direset admin, silakan ganti kata sandi baru dulu")
				return "", false
			}
		}
		// Paket kedaluwarsa (P1-7): /mutasi hanya untuk subscription aktif.
		if !s.hasActiveSubscription(r, memberID) {
			writeErr(w, http.StatusForbidden, "subscription_expired", "langganan tidak aktif atau sudah kedaluwarsa")
			return "", false
		}
		_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE api_keys SET last_used_at=NOW() WHERE key_hash=?`, hash)
		return memberID, true
	}
	// Fall back to member session.
	claims, ok := s.validSessionClaims(r, "member")
	if !ok {
		if _, err := r.Cookie("mh_session"); err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "login atau API key diperlukan")
		} else {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "sesi tidak valid")
		}
		return "", false
	}
	// Gate yang sama dengan authMember (P1-1 + P1-2): disabled,
	// must_change_password, dan session_version.
	if status, code, msg := s.checkMemberAccess(r, claims.Subject, claims.SessionVersion, true); status != 0 {
		writeErr(w, status, code, msg)
		return "", false
	}
	// Paket kedaluwarsa (P1-7): /mutasi hanya untuk subscription aktif.
	if !s.hasActiveSubscription(r, claims.Subject) {
		writeErr(w, http.StatusForbidden, "subscription_expired", "langganan tidak aktif atau sudah kedaluwarsa")
		return "", false
	}
	return claims.Subject, true
}

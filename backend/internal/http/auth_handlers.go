package http

import (
	"crypto/hmac"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"mutasi-hub/internal/auth"
	"mutasi-hub/internal/crypto"
)

type registerReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// validEmail validates an address per RFC 5322 (net/mail.ParseAddress)
// and requires the parsed address to be exactly the input (no display
// name, no extra text) — P2-1. The old check (contains "@" and ".")
// accepted "a@b" and similar junk.
func validEmail(e string) bool {
	e = strings.TrimSpace(e)
	if e == "" || len(e) > 255 || strings.ContainsAny(e, " <>") {
		return false
	}
	addr, err := mail.ParseAddress(e)
	if err != nil || addr == nil || addr.Address != e {
		return false
	}
	at := strings.LastIndex(e, "@")
	return at > 0 && strings.Contains(e[at:], ".")
}

// validateMemberName checks the 1-255 char rule shared by register,
// admin member edit and Google-provisioned accounts (P2-1).
func validateMemberName(name string) bool {
	n := len(strings.TrimSpace(name))
	return n >= 1 && n <= 255
}

// passwordTooLong reports whether a password exceeds bcrypt's 72-byte
// limit (P2-4): callers answer 400 with a generic message instead of
// leaking the bcrypt error verbatim.
func passwordTooLong(pw string) bool { return len(pw) > 72 }

// genericHashError is the client-facing message for any password
// hashing failure — never err.Error() (P2-4).
const genericHashError = "kata sandi maksimal 72 karakter"

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	// P1-15: 5 percobaan register / jam / IP.
	if !s.ipHourly.allow("register:" + clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak pendaftaran dari IP ini, coba lagi nanti")
		return
	}
	var req registerReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !validEmail(req.Email) {
		writeErr(w, http.StatusBadRequest, "invalid_email", "format email tidak valid")
		return
	}
	if !validateMemberName(req.Name) {
		writeErr(w, http.StatusBadRequest, "invalid_name", "nama wajib diisi (maksimal 255 karakter)")
		return
	}
	if len(req.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password", "password minimal 8 karakter")
		return
	}
	if passwordTooLong(req.Password) {
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.log.Printf("http: register: hash password gagal: %v", err)
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	id := newID()
	_, err = s.store.DB.ExecContext(r.Context(), `INSERT INTO members (id, email, password_hash, name)
		VALUES (?, ?, ?, ?)`, id, req.Email, hash, strings.TrimSpace(req.Name))
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") {
			writeErr(w, http.StatusConflict, "email_taken", "email sudah terdaftar")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat akun")
		return
	}
	// Trial subscription (1 hari) for every new member.
	var trialID int64
	if err := s.store.DB.QueryRowContext(r.Context(),
		`SELECT id FROM plans WHERE slug='trial' AND is_active=1 LIMIT 1`).Scan(&trialID); err == nil {
		_, _ = s.store.DB.ExecContext(r.Context(), `INSERT INTO subscriptions (id, member_id, plan_id, status, starts_at, expires_at)
			VALUES (?, ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`, newID(), id, trialID)
	}
	// Email verification token: token disimpan hashed di DB, lalu
	// tautan verifikasi dikirim via SMTP bila sudah dikonfigurasi
	// (v37). Kirim gagal = fail-open (register tetap sukses; token
	// tetap tersimpan dan bisa dikirim ulang nanti).
	token := randomToken()
	if _, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO email_verification_tokens (id, member_id, token_hash, expires_at)
		VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`, newID(), id, sha256Hex(token)); err != nil {
		s.log.Printf("http: register: simpan token verifikasi gagal member=%s: %v", id, err)
		writeErr(w, http.StatusInternalServerError, "token_error", "gagal menyiapkan verifikasi email")
		return
	}
	s.sendVerificationEmail(r.Context(), id, req.Email, token)
	if err := s.setSession(w, id, "member"); err != nil {
		writeErr(w, http.StatusInternalServerError, "session_error", "gagal membuat sesi")
		return
	}
	s.audit(r, "member", id, "register", "member registered")
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "email": req.Email, "name": req.Name})
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TOTPCode string `json:"totp_code"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req loginReq
	if !readJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	// P1-17: kunci limiter per-email saja (bukan IP+email) — IP egress
	// berotasi membuat bucket per-IP tidak pernah penuh. actor_id audit:
	// id member bila email dikenal, bila tidak hash email (JANGAN email
	// mentah — actor_id VARCHAR(64), sha256 hex = 64 char).
	failKey := email
	var id, hash, name, mstatus string
	var totpSecret sql.NullString
	var totpEnabled int
	var mustChange int
	failActor := func(knownID string) string {
		if knownID != "" {
			return knownID
		}
		return sha256Hex(email)
	}
	if s.authFail.tooMany(failKey) {
		s.audit(r, "member", failActor(""), "login_blocked", "terlalu banyak percobaan login gagal")
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak percobaan gagal, coba lagi 15 menit lagi")
		return
	}
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT id, password_hash, name,
		totp_secret, totp_enabled, COALESCE(status,'active'), COALESCE(must_change_password,0) FROM members WHERE email=?`, email).
		Scan(&id, &hash, &name, &totpSecret, &totpEnabled, &mstatus, &mustChange)
	if err != nil {
		// Email tak dikenal: tetap 401 generik (tanpa enumerasi).
		s.authFail.record(failKey)
		s.audit(r, "member", failActor(""), "login_failed", "login gagal: email atau password salah")
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "email atau password salah")
		return
	}
	// P2-20: akun disabled dicek SEGERA setelah member ditemukan —
	// sebelum cek sandi/TOTP — agar percobaan pada akun nonaktif tidak
	// menghabiskan budget rate-limit maupun membocorkan lewat TOTP.
	if mstatus == "disabled" {
		writeErr(w, http.StatusForbidden, "account_disabled", "akun dinonaktifkan oleh admin, hubungi dukungan")
		return
	}
	if hash == "" || !auth.CheckPassword(hash, req.Password) {
		s.authFail.record(failKey)
		s.audit(r, "member", failActor(id), "login_failed", "login gagal: email atau password salah")
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "email atau password salah")
		return
	}
	if totpEnabled == 1 {
		if !totpSecret.Valid || len(s.encKey) == 0 {
			writeErr(w, http.StatusInternalServerError, "totp_error", "2FA aktif tapi secret tidak bisa dibaca")
			return
		}
		secret, err := crypto.Decrypt(s.encKey, totpSecret.String)
		if err != nil || !auth.VerifyTOTP(secret, req.TOTPCode, time.Now()) {
			// P2-17: recovery code sekali pakai diterima sebagai
			// pengganti kode TOTP (dikonsumsi saat dipakai).
			if req.TOTPCode == "" || !s.consumeRecoveryCode(r, id, req.TOTPCode) {
				s.authFail.record(failKey)
				s.audit(r, "member", failActor(id), "login_failed", "login gagal: kode 2FA salah")
				writeErr(w, http.StatusUnauthorized, "invalid_totp", "kode 2FA salah atau kedaluwarsa")
				return
			}
			s.audit(r, "member", id, "login_recovery_code", "login memakai recovery code 2FA (sekali pakai)")
		}
	}
	s.authFail.reset(failKey)
	if err := s.setSession(w, id, "member"); err != nil {
		writeErr(w, http.StatusInternalServerError, "session_error", "gagal membuat sesi")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "email": req.Email, "name": name, "must_change_password": mustChange == 1})
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// randomTempPassword membuat sandi reset acak (P0-B): 16 karakter
// alfanumerik dari crypto/rand. Nilai ini tampil SEKALI ke admin di
// respons reset — jangan pernah di-log atau disimpan.
func randomTempPassword() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand praktis tidak pernah gagal; fallback deterministik
		// TIDAK dipakai — kembalikan error lewat panjang nol.
		return ""
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// --- Google OAuth ---

func (s *Server) handleGoogleAuth(w http.ResponseWriter, r *http.Request) {
	if s.cfg.GoogleClientID == "" || s.cfg.GoogleRedirectURL == "" {
		writeErr(w, http.StatusServiceUnavailable, "google_not_configured",
			"Google OAuth belum dikonfigurasi (GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URL)")
		return
	}
	// P2-19: peran diikat ke state yang di-HMAC server (bukan cookie
	// klien mh_oauth_role — cookie itu sudah dihapus). Nonce disimpan di
	// cookie HttpOnly mh_oauth_state dan harus cocok di callback.
	role := r.URL.Query().Get("role")
	if role != "admin" {
		role = "member"
	}
	state, nonce, err := makeOAuthState(s.jwtSecret(), role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server_error", "gagal menyiapkan login Google")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "mh_oauth_state", Value: nonce, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: 600})
	q := url.Values{
		"client_id":     {s.cfg.GoogleClientID},
		"redirect_uri":  {s.cfg.GoogleRedirectURL},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"state":         {state},
		"access_type":   {"online"},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+q.Encode(), http.StatusFound)
}

type googleUserinfo struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (s *Server) exchangeGoogleCode(r *http.Request, code string) (*googleUserinfo, error) {
	ctx := r.Context()
	form := url.Values{
		"code":          {code},
		"client_id":     {s.cfg.GoogleClientID},
		"client_secret": {s.cfg.GoogleClientSecret},
		"redirect_uri":  {s.cfg.GoogleRedirectURL},
		"grant_type":    {"authorization_code"},
	}
	resp, err := http.PostForm("https://oauth2.googleapis.com/token", form)
	if err != nil {
		return nil, fmt.Errorf("google: token exchange: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("google: read token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google: token exchange HTTP %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.AccessToken == "" {
		return nil, fmt.Errorf("google: parse token response: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	uresp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google: userinfo: %w", err)
	}
	defer uresp.Body.Close()
	ubody, err := io.ReadAll(io.LimitReader(uresp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("google: read userinfo: %w", err)
	}
	if uresp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google: userinfo HTTP %d", uresp.StatusCode)
	}
	var u googleUserinfo
	if err := json.Unmarshal(ubody, &u); err != nil {
		return nil, fmt.Errorf("google: parse userinfo: %w", err)
	}
	if u.Sub == "" || u.Email == "" {
		return nil, fmt.Errorf("google: userinfo missing sub/email")
	}
	return &u, nil
}

func (s *Server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	// Browser-driven flow: the frontend links straight to /auth/google, so
	// every outcome must redirect back to the frontend (a raw JSON page
	// here would strand the user). Errors surface on /login as a banner.
	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		s.redirectFrontend(w, r, "/login?error=google_error")
		return
	}
	// P2-19: verifikasi HMAC state + kecocokan nonce cookie. State
	// palsu / peran yang diubah klien ditolak di sini. Jalur admin
	// tetap HANYA lewat allowlist ADMIN_GOOGLE_EMAILS di bawah —
	// state hanya memilih jalur, bukan memberi hak admin.
	state := r.URL.Query().Get("state")
	sc, err := r.Cookie("mh_oauth_state")
	if err != nil {
		s.redirectFrontend(w, r, "/login?error=invalid_state")
		return
	}
	role, ok := verifyOAuthState(s.jwtSecret(), state, sc.Value)
	if !ok {
		s.redirectFrontend(w, r, "/login?error=invalid_state")
		return
	}
	u, err := s.exchangeGoogleCode(r, r.URL.Query().Get("code"))
	if err != nil {
		s.redirectFrontend(w, r, "/login?error=google_error")
		return
	}
	email := strings.ToLower(strings.TrimSpace(u.Email))
	// P2-1: akun dari Google juga harus lolos validasi nama/email yang
	// sama (saat ini callback tidak membuat akun baru — unknown email
	// diarahkan ke not_registered — tapi email/nama tak valid dari
	// provider tetap ditolak, bukan dipakai mentah).
	if !validEmail(email) || !validateMemberName(u.Name) {
		s.redirectFrontend(w, r, "/login?error=google_error")
		return
	}

	if role == "admin" {
		if !s.cfg.IsAdminGoogleEmail(email) {
			s.redirectFrontend(w, r, "/login?error=not_admin")
			return
		}
		var id string
		err := s.store.DB.QueryRowContext(r.Context(), `SELECT id FROM admin_users WHERE email=?`, email).Scan(&id)
		if err == sql.ErrNoRows {
			id = newID()
			_, _ = s.store.DB.ExecContext(r.Context(), `INSERT INTO admin_users (id, email, role) VALUES (?, ?, 'admin')`, id, email)
		} else if err != nil {
			s.redirectFrontend(w, r, "/login?error=server_error")
			return
		}
		_ = s.setSession(w, id, "admin")
		s.redirectFrontend(w, r, "/admin")
		return
	}

	// Member: match by google_sub first, then by email (link sub).
	var id, name, mstatus string
	var totpEnabled int
	err = s.store.DB.QueryRowContext(r.Context(), `SELECT id, name, COALESCE(status,'active'), COALESCE(totp_enabled,0) FROM members WHERE google_sub=?`, u.Sub).Scan(&id, &name, &mstatus, &totpEnabled)
	if err == sql.ErrNoRows {
		err = s.store.DB.QueryRowContext(r.Context(), `SELECT id, name, COALESCE(status,'active'), COALESCE(totp_enabled,0) FROM members WHERE email=?`, email).Scan(&id, &name, &mstatus, &totpEnabled)
		if err == sql.ErrNoRows {
			// Unknown google_sub AND unknown email: do NOT create an account silently.
			// Send the user back to /login, where the not_registered banner
			// invites them to register.
			s.redirectFrontend(w, r, "/login?error=not_registered")
			return
		}
		if err != nil {
			s.redirectFrontend(w, r, "/login?error=server_error")
			return
		}
		_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE members SET google_sub=? WHERE id=?`, u.Sub, id)
	} else if err != nil {
		s.redirectFrontend(w, r, "/login?error=server_error")
		return
	}
	if mstatus == "disabled" {
		s.redirectFrontend(w, r, "/login?error=account_disabled")
		return
	}
	// P1-3: member ber-TOTP JANGAN langsung diberi sesi — Google login
	// tidak boleh melewati 2FA. Beri token pending TOTP (10 menit) di
	// cookie HttpOnly, frontend mengarah ke verifikasi TOTP dulu.
	if totpEnabled == 1 {
		tok, err := auth.NewTOTPPendingJWT(s.jwtSecret(), id, 10*time.Minute)
		if err != nil {
			s.redirectFrontend(w, r, "/login?error=server_error")
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name: "mh_totp_pending", Value: tok, Path: "/api/v1/auth/totp/verify-pending",
			HttpOnly: true, Secure: true,
			SameSite: http.SameSiteLaxMode, MaxAge: 600,
		})
		s.redirectFrontend(w, r, "/login?totp_required=1")
		return
	}
	if err := s.setSession(w, id, "member"); err != nil {
		s.redirectFrontend(w, r, "/login?error=server_error")
		return
	}
	s.redirectFrontend(w, r, "/member/dashboard")
}

// handleTOTPVerifyPending menyelesaikan login Google untuk member
// ber-TOTP (P1-3): validasi token pending (cookie mh_totp_pending) +
// kode TOTP → bila lolos, setSession + balas flag must_change_password
// agar frontend tahu harus mengarah ke ganti sandi.
func (s *Server) handleTOTPVerifyPending(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	c, err := r.Cookie("mh_totp_pending")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "totp_pending_missing", "sesi verifikasi 2FA tidak ditemukan, silakan login ulang via Google")
		return
	}
	claims, err := auth.ValidateJWT(s.jwtSecret(), c.Value)
	if err != nil || claims.Role != "totp-pending" || claims.Purpose != "totp-pending" {
		writeErr(w, http.StatusUnauthorized, "totp_pending_invalid", "sesi verifikasi 2FA tidak valid atau kedaluwarsa, silakan login ulang via Google")
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	var encSecret sql.NullString
	var mustChange int
	err = s.store.DB.QueryRowContext(r.Context(), `SELECT totp_secret, COALESCE(must_change_password,0) FROM members WHERE id=?`, claims.Subject).Scan(&encSecret, &mustChange)
	if err != nil || !encSecret.Valid {
		writeErr(w, http.StatusUnauthorized, "totp_pending_invalid", "sesi verifikasi 2FA tidak valid, silakan login ulang via Google")
		return
	}
	secret, err := crypto.Decrypt(s.encKey, encSecret.String)
	if err != nil || !auth.VerifyTOTP(secret, req.Code, time.Now()) {
		if req.Code == "" || !s.consumeRecoveryCode(r, claims.Subject, req.Code) {
			writeErr(w, http.StatusUnauthorized, "invalid_totp", "kode 2FA salah atau kedaluwarsa")
			return
		}
	}
	if err := s.setSession(w, claims.Subject, "member"); err != nil {
		writeErr(w, http.StatusInternalServerError, "session_error", "gagal membuat sesi")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "mh_totp_pending", Value: "", Path: "/api/v1/auth/totp/verify-pending",
		HttpOnly: true, Secure: true,
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	writeJSON(w, http.StatusOK, map[string]any{"must_change_password": mustChange == 1})
}

// redirectFrontend sends the browser back to the Next.js frontend.
// Used by the browser-driven Google OAuth callback, which must never
// strand the user on a raw JSON page.
func (s *Server) redirectFrontend(w http.ResponseWriter, r *http.Request, path string) {
	base := strings.TrimRight(s.cfg.FrontendURL, "/")
	if base == "" {
		base = "http://localhost:3000"
	}
	http.Redirect(w, r, base+path, http.StatusFound)
}

// --- Forgot / reset password (v37: tautan reset dikirim via SMTP
// bila dikonfigurasi; gagal kirim = fail-open, jawaban tetap OK agar
// tidak membocorkan email mana yang terdaftar) ---

func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	// P1-15: 5 percobaan / jam / IP (dihitung sebelum lookup email agar
	// tidak bisa dipakai untuk enumerasi maupun spam).
	if !s.ipHourly.allow("forgot:" + clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak permintaan reset dari IP ini, coba lagi nanti")
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	var id string
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT id FROM members WHERE email=?`, email).Scan(&id)
	// Always answer OK to avoid leaking which emails exist.
	if err == nil {
		token := randomToken()
		// P0-A: 3 placeholder, 3 argumen; error dicek dan di-log (dulu
		// argumen ke-4 membuat INSERT selalu gagal diam-diam).
		if _, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO password_reset_tokens (id, member_id, token_hash, expires_at)
			VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`, newID(), id, sha256Hex(token)); err != nil {
			s.log.Printf("http: forgot-password: simpan token reset gagal member=%s: %v", id, err)
			writeErr(w, http.StatusInternalServerError, "token_error", "gagal menyiapkan reset password")
			return
		}
		// v37: kirim tautan reset via SMTP (fail-open — gagal kirim
		// tidak mengubah jawaban OK di bawah).
		s.sendResetEmail(r.Context(), id, email, token)
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "bila email terdaftar, instruksi reset akan dikirim"})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	// Rate-limit per IP+token (reset carries no email): 5 failed
	// attempts / 15 minutes.
	failKey := clientIP(r) + "|" + sha256Hex(req.Token)
	if s.authFail.tooMany(failKey) {
		s.audit(r, "member", "", "reset_blocked", "terlalu banyak percobaan reset password gagal")
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak percobaan gagal, coba lagi 15 menit lagi")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password", "password minimal 8 karakter")
		return
	}
	if passwordTooLong(req.NewPassword) {
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	var memberID string
	var expires time.Time
	var used sql.NullTime
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT member_id, expires_at, used_at
		FROM password_reset_tokens WHERE token_hash=? ORDER BY created_at DESC LIMIT 1`, sha256Hex(req.Token)).
		Scan(&memberID, &expires, &used)
	if err != nil || used.Valid || time.Now().After(expires) {
		s.authFail.record(failKey)
		writeErr(w, http.StatusBadRequest, "invalid_token", "token reset tidak valid atau kedaluwarsa")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		s.log.Printf("http: reset-password: hash gagal: %v", err)
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	// Ganti sandi via token = member memilih sandi baru sendiri: flag wajib
	// ganti direset + semua sesi lama dicabut (P1-2).
	_, err = s.store.DB.ExecContext(r.Context(), `UPDATE members SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=?`, hash, memberID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengganti password")
		return
	}
	// Invalidate ALL reset tokens of this member, not just the one used —
	// otherwise other outstanding tokens stay usable after the reset.
	_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE password_reset_tokens SET used_at=NOW() WHERE member_id=? AND used_at IS NULL`, memberID)
	s.authFail.reset(failKey)
	writeJSON(w, http.StatusOK, map[string]any{"message": "password berhasil diganti"})
}

// handleVerifyEmail verifies a member's email from a token created at
// register time (stored as SHA-256 hash in email_verification_tokens).
// NOTE: without SMTP the token is never delivered to the user, so in
// practice this endpoint can only be used with a token obtained through
// another channel (e.g. admin) until SMTP is configured.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	var memberID string
	var expires time.Time
	var used sql.NullTime
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT member_id, expires_at, used_at
		FROM email_verification_tokens WHERE token_hash=? ORDER BY created_at DESC LIMIT 1`, sha256Hex(req.Token)).
		Scan(&memberID, &expires, &used)
	if err != nil || used.Valid || time.Now().After(expires) {
		writeErr(w, http.StatusBadRequest, "invalid_token", "token verifikasi tidak valid atau kedaluwarsa")
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET email_verified_at=NOW() WHERE id=?`, memberID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memverifikasi email")
		return
	}
	_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE email_verification_tokens SET used_at=NOW() WHERE token_hash=?`, sha256Hex(req.Token))
	writeJSON(w, http.StatusOK, map[string]any{"message": "email berhasil diverifikasi"})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	// P1-2: logout mencabut SEMUA sesi subjek ini — token lama (termasuk
	// yang dicuri) tidak lagi lolos cek session_version di authMember.
	// Best-effort: tanpa cookie valid, tetap bersihkan cookie + balas OK.
	if claims, ok := s.validSessionClaims(r, "member", "admin"); ok {
		s.bumpSessionVersion(r, claims.Subject, claims.Role)
	}
	s.clearSession(w)
	writeJSON(w, http.StatusOK, map[string]any{"message": "logout berhasil"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var email, name string
	var verified sql.NullTime
	var totpEnabled int
	var mustChange int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT email, name, email_verified_at, totp_enabled, COALESCE(must_change_password,0)
		FROM members WHERE id=?`, id).Scan(&email, &name, &verified, &totpEnabled, &mustChange)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "member tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "email": email, "name": name,
		"email_verified": verified.Valid, "totp_enabled": totpEnabled == 1,
		"must_change_password": mustChange == 1,
	})
}

// --- Ganti kata sandi (v20, diubah v21 — P0-B / P2-7) ---
//
// POST /api/v1/auth/change-password — sesi member. Dua alur:
//   - Paksa pasca-reset (must_change_password=1): current_password TIDAK
//     wajib — member memang tidak tahu sandi acak reset admin.
//   - Ganti mandiri (flag=0): current_password WAJIB dan harus cocok
//     dengan hash saat ini (salah → 400 invalid_current_password).
//
// Aturan sandi baru: minimal 8 karakter, tidak boleh sama dengan sandi
// saat ini. Berhasil -> hash baru + flag wajib ganti direset + semua sesi
// lama dicabut (session_version naik, P1-2).

// handleChangePassword changes the member's own password and clears the
// must_change_password flag (if set).
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password", "kata sandi baru minimal 8 karakter")
		return
	}
	if passwordTooLong(req.NewPassword) {
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	id, _ := memberID(r)
	var hash string
	var mustChange int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(password_hash,''), COALESCE(must_change_password,0) FROM members WHERE id=?`, id).Scan(&hash, &mustChange)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "not_found", "member tidak ditemukan")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca akun")
		return
	}
	if mustChange == 0 {
		if req.CurrentPassword == "" || hash == "" || !auth.CheckPassword(hash, req.CurrentPassword) {
			writeErr(w, http.StatusBadRequest, "invalid_current_password", "kata sandi saat ini salah")
			return
		}
	}
	if hash != "" && auth.CheckPassword(hash, req.NewPassword) {
		writeErr(w, http.StatusBadRequest, "same_password", "kata sandi baru tidak boleh sama dengan kata sandi saat ini")
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		s.log.Printf("http: change-password: hash gagal: %v", err)
		writeErr(w, http.StatusBadRequest, "weak_password", genericHashError)
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=?`, newHash, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengganti kata sandi")
		return
	}
	// P2-7 (lanjutan): session_version naik mencabut SEMUA sesi lain,
	// tapi sesi pemohon sendiri di-issue ulang agar tidak ikut mati.
	if err := s.setSession(w, id, "member"); err != nil {
		s.log.Printf("http: change-password: re-issue sesi gagal member=%s: %v", id, err)
	}
	s.audit(r, "member", id, "password_change", "member mengganti kata sandi")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- 2FA TOTP (P2-17) ---
//
// Enable: bila 2FA sudah aktif (totp_enabled=1), secret TIDAK BOLEH
// ditimpa tanpa verifikasi ulang — pemanggil wajib menyertakan
// current_password + kode TOTP saat ini (totp_code). Verify: setelah
// kode pertama lolos, 8 recovery code sekali pakai di-generate,
// hash-nya disimpan, dan plaintext-nya tampil SEKALI di respons.
// Disable: wajib kode TOTP saat ini. Login (handleLogin) dan verifikasi
// pending Google menerima recovery code sebagai pengganti kode TOTP.

const recoveryCodeCount = 8

// generateRecoveryCodes membuat n kode sekali pakai (10 karakter
// alfanumerik tanpa karakter ambigu). Plaintext HANYA dikembalikan ke
// pemanggil — yang disimpan di DB adalah SHA-256-nya.
func generateRecoveryCodes(n int) []string {
	const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
	codes := make([]string, 0, n)
	for i := 0; i < n; i++ {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			continue
		}
		for j := range b {
			b[j] = alphabet[int(b[j])%len(alphabet)]
		}
		codes = append(codes, string(b))
	}
	return codes
}

// consumeRecoveryCode checks a candidate code against the member's
// unused recovery codes and marks the match used (sekali pakai).
// Perbandingan hash memakai hmac.Equal (constant-time).
func (s *Server) consumeRecoveryCode(r *http.Request, memberID, code string) bool {
	code = strings.TrimSpace(code)
	if code == "" || !s.store.Available() {
		return false
	}
	want := sha256Hex(code)
	var id string
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT id FROM totp_recovery_codes
		WHERE member_id=? AND code_hash=? AND used_at IS NULL LIMIT 1`, memberID, want).Scan(&id)
	if err != nil {
		return false
	}
	res, err := s.store.DB.ExecContext(r.Context(), `UPDATE totp_recovery_codes SET used_at=NOW()
		WHERE id=? AND used_at IS NULL`, id)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

func (s *Server) handle2FAEnable(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	id, _ := memberID(r)
	var req struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	// Body opsional bila 2FA belum aktif; readJSON pada body kosong
	// akan gagal — hanya parse bila ada isi.
	if r.ContentLength != 0 {
		if !readJSON(w, r, &req) {
			return
		}
	}
	// Bila 2FA sudah aktif, minta verifikasi ulang sebelum menimpa secret.
	var curEnabled int
	var curSecret sql.NullString
	var curHash string
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(totp_enabled,0), totp_secret, COALESCE(password_hash,'') FROM members WHERE id=?`, id).
		Scan(&curEnabled, &curSecret, &curHash)
	if curEnabled == 1 {
		if req.CurrentPassword == "" || req.TOTPCode == "" {
			writeErr(w, http.StatusBadRequest, "totp_already_enabled", "2FA sudah aktif; kirim kata sandi saat ini dan kode TOTP saat ini untuk mengganti secret")
			return
		}
		if curHash == "" || !auth.CheckPassword(curHash, req.CurrentPassword) {
			writeErr(w, http.StatusBadRequest, "invalid_current_password", "kata sandi saat ini salah")
			return
		}
		if !curSecret.Valid || len(s.encKey) == 0 {
			writeErr(w, http.StatusInternalServerError, "totp_error", "secret 2FA saat ini tidak bisa dibaca")
			return
		}
		oldSecret, err := crypto.Decrypt(s.encKey, curSecret.String)
		if err != nil || !auth.VerifyTOTP(oldSecret, req.TOTPCode, time.Now()) {
			writeErr(w, http.StatusUnauthorized, "invalid_totp", "kode 2FA saat ini salah atau kedaluwarsa")
			return
		}
	}
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		s.log.Printf("http: 2fa enable: generate secret gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "totp_error", "gagal menyiapkan 2FA")
		return
	}
	enc, err := crypto.Encrypt(s.encKey, secret)
	if err != nil {
		s.log.Printf("http: 2fa enable: encrypt gagal: %v", err)
		writeErr(w, http.StatusInternalServerError, "totp_error", "gagal menyiapkan 2FA")
		return
	}
	// Secret disimpan terenkripsi; enable hanya setelah kode valid
	// diverifikasi (handle2FAVerify). Secret lama yang aktif ikut
	// diganti di sini hanya bila verifikasi ulang di atas lolos.
	_, err = s.store.DB.ExecContext(r.Context(), `UPDATE members SET totp_secret=?, totp_enabled=0 WHERE id=?`, enc, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan secret 2FA")
		return
	}
	var email string
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT email FROM members WHERE id=?`, id).Scan(&email)
	writeJSON(w, http.StatusOK, map[string]any{
		"secret": secret,
		"otpauth_url": "otpauth://totp/MutasiHub:" + url.QueryEscape(email) +
			"?secret=" + secret + "&issuer=MutasiHub",
		"message": "scan dengan aplikasi authenticator, lalu verifikasi dengan kode 6 digit",
	})
}

func (s *Server) handle2FAVerify(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	id, _ := memberID(r)
	var req struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	var encSecret sql.NullString
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT totp_secret FROM members WHERE id=?`, id).Scan(&encSecret)
	if err != nil || !encSecret.Valid {
		writeErr(w, http.StatusBadRequest, "totp_not_setup", "2FA belum diaktifkan, panggil /2fa/enable dulu")
		return
	}
	secret, err := crypto.Decrypt(s.encKey, encSecret.String)
	if err != nil || !auth.VerifyTOTP(secret, req.Code, time.Now()) {
		writeErr(w, http.StatusUnauthorized, "invalid_totp", "kode 2FA salah atau kedaluwarsa")
		return
	}
	// Aktifkan + generate recovery code sekali pakai (tampil SEKALI).
	codes := generateRecoveryCodes(recoveryCodeCount)
	tx, err := s.store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan 2FA")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `UPDATE members SET totp_enabled=1 WHERE id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan 2FA")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM totp_recovery_codes WHERE member_id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan 2FA")
		return
	}
	for _, c := range codes {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO totp_recovery_codes (id, member_id, code_hash) VALUES (?, ?, ?)`, newID(), id, sha256Hex(c)); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan 2FA")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan 2FA")
		return
	}
	s.audit(r, "member", id, "2fa_enable", "TOTP enabled")
	writeJSON(w, http.StatusOK, map[string]any{
		"message":        "2FA berhasil diaktifkan",
		"recovery_codes": codes,
		"recovery_note":  "simpan recovery code ini di tempat aman — masing-masing hanya bisa dipakai sekali dan tidak akan ditampilkan lagi",
	})
}

// handle2FADisable menonaktifkan TOTP. Wajib kode TOTP saat ini —
// tanpa itu, sesi yang dibajak bisa mematikan 2FA korban.
func (s *Server) handle2FADisable(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	if len(s.encKey) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "encryption_unavailable", "ENCRYPTION_KEY belum dikonfigurasi")
		return
	}
	id, _ := memberID(r)
	var req struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Code) == "" {
		writeErr(w, http.StatusBadRequest, "invalid_totp", "kode 2FA saat ini wajib diisi")
		return
	}
	var encSecret sql.NullString
	var enabled int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT totp_secret, COALESCE(totp_enabled,0) FROM members WHERE id=?`, id).Scan(&encSecret, &enabled)
	if err != nil || enabled != 1 || !encSecret.Valid {
		writeErr(w, http.StatusBadRequest, "totp_not_setup", "2FA tidak aktif")
		return
	}
	secret, err := crypto.Decrypt(s.encKey, encSecret.String)
	if err != nil || !auth.VerifyTOTP(secret, req.Code, time.Now()) {
		writeErr(w, http.StatusUnauthorized, "invalid_totp", "kode 2FA salah atau kedaluwarsa")
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET totp_enabled=0, totp_secret=NULL WHERE id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menonaktifkan 2FA")
		return
	}
	_, _ = s.store.DB.ExecContext(r.Context(), `DELETE FROM totp_recovery_codes WHERE member_id=?`, id)
	s.audit(r, "member", id, "2fa_disable", "TOTP disabled")
	writeJSON(w, http.StatusOK, map[string]any{"message": "2FA berhasil dinonaktifkan"})
}

// verifyRecoveryCodeHash reports whether candidate matches a stored
// SHA-256 recovery-code hash (constant-time). Dipakai unit test.
func verifyRecoveryCodeHash(storedHex, candidate string) bool {
	return hmac.Equal([]byte(storedHex), []byte(sha256Hex(candidate)))
}

// --- Admin login (email + PIN) ---

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		Email string `json:"email"`
		Pin   string `json:"pin"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	// P1-17: kunci limiter per-email saja (IP egress berotasi); audit
	// gagal dengan id admin bila dikenal, bila tidak hash email.
	failKey := email
	var id, hash string
	failActor := func(knownID string) string {
		if knownID != "" {
			return knownID
		}
		return sha256Hex(email)
	}
	if s.authFail.tooMany(failKey) {
		s.audit(r, "admin", failActor(""), "login_blocked", "terlalu banyak percobaan login admin gagal")
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "terlalu banyak percobaan gagal, coba lagi 15 menit lagi")
		return
	}
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT id, pin_hash FROM admin_users WHERE email=?`,
		email).Scan(&id, &hash)
	if err != nil || hash == "" || !auth.CheckPassword(hash, req.Pin) {
		s.authFail.record(failKey)
		s.audit(r, "admin", failActor(id), "login_failed", "login admin gagal: email atau PIN salah")
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "email atau PIN salah")
		return
	}
	s.authFail.reset(failKey)
	if err := s.setSession(w, id, "admin"); err != nil {
		writeErr(w, http.StatusInternalServerError, "session_error", "gagal membuat sesi")
		return
	}
	s.audit(r, "admin", id, "login", "admin login via PIN")
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "email": req.Email})
}

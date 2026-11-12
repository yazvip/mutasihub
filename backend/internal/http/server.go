// Package http implements the MutasiHub HTTP API on the stdlib
// net/http router (no heavy framework). Member-facing JSON never
// contains the upstream provider's real name or base URL — providers
// appear only as the generic labels "DANA" / "BCA".
package http

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"mutasi-hub/internal/auth"
	"mutasi-hub/internal/config"
	"mutasi-hub/internal/connecta"
	"mutasi-hub/internal/crypto"
	"mutasi-hub/internal/db"
	syncpkg "mutasi-hub/internal/sync"
)

// Server wires config, store, Connecta client and the sync worker.
type Server struct {
	cfg      *config.Config
	store    *db.Store
	connecta *connecta.Client
	syncer   *syncpkg.Syncer
	encKey   []byte
	mux      *http.ServeMux
	limiter  *Limiter
	authFail *failLimiter // failed login / reset attempts, per identity
	ipHourly *rateWindow  // register & forgot-password: 5/jam/IP (P1-15)
	log      *log.Logger
}

type ctxKey string

const (
	ctxMemberID ctxKey = "member_id"
	ctxAdminID  ctxKey = "admin_id"
	ctxAPIKeyID ctxKey = "api_key_id"
)

// New builds the server and registers all routes.
func New(cfg *config.Config, store *db.Store) *Server {
	encKey, err := crypto.ParseKey(cfg.EncryptionKey)
	if err != nil {
		log.Printf("http: ENCRYPTION_KEY invalid (%v); credential encryption disabled until fixed", err)
		encKey = nil
	}
	conn := connecta.New(cfg.ConnectaBaseURL, cfg.ConnectaAPIKey)
	s := &Server{
		cfg: cfg, store: store, connecta: conn,
		encKey:   encKey,
		mux:      http.NewServeMux(),
		limiter:  NewLimiter(),
		authFail: newFailLimiter(),
		ipHourly: newRateWindow(5, time.Hour),
		log:      log.Default(),
	}
	s.syncer = syncpkg.New(store, conn, encKey)
	s.routes()
	return s
}

// Handler returns the root handler.
func (s *Server) Handler() http.Handler { return s.mux }

// Syncer exposes the worker for main.go.
func (s *Server) Syncer() *syncpkg.Syncer { return s.syncer }

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /healthz", s.handleHealthz)
	m.HandleFunc("GET /api/v1/settings", s.handlePublicSettings)

	// Auth (public).
	m.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	m.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	m.HandleFunc("GET /api/v1/auth/google", s.handleGoogleAuth)
	m.HandleFunc("GET /api/v1/auth/google/callback", s.handleGoogleCallback)
	m.HandleFunc("POST /api/v1/auth/forgot-password", s.handleForgotPassword)
	m.HandleFunc("POST /api/v1/auth/reset-password", s.handleResetPassword)
	m.HandleFunc("POST /api/v1/auth/verify-email", s.handleVerifyEmail)
	m.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	m.HandleFunc("POST /api/v1/auth/totp/verify-pending", s.handleTOTPVerifyPending)
	m.HandleFunc("GET /api/v1/auth/me", s.authMember(s.handleMe))
	m.HandleFunc("POST /api/v1/auth/change-password", s.authMember(s.handleChangePassword))
	m.HandleFunc("POST /api/v1/auth/2fa/enable", s.authMember(s.handle2FAEnable))
	m.HandleFunc("POST /api/v1/auth/2fa/verify", s.authMember(s.handle2FAVerify))
	m.HandleFunc("POST /api/v1/auth/2fa/disable", s.authMember(s.handle2FADisable))

	// Member.
	m.HandleFunc("GET /api/v1/member/dashboard", s.authMember(s.handleDashboard))
	m.HandleFunc("GET /api/v1/member/profile", s.authMember(s.handleProfile))
	// Instant Callback (v42a).
	m.HandleFunc("PUT /api/v1/member/callback", s.authMember(s.handleSetMemberCallback))
	m.HandleFunc("POST /api/v1/member/callback/test", s.authMember(s.handleTestMemberCallback))
	m.HandleFunc("POST /api/v1/member/callback/secret/regenerate", s.authMember(s.handleRegenerateCallbackSecret))
	m.HandleFunc("GET /api/v1/member/callback/deliveries", s.authMember(s.handleListCallbackDeliveries))
	m.HandleFunc("GET /api/v1/member/notifications", s.authMember(s.handleGetMemberNotifications))
	m.HandleFunc("PUT /api/v1/member/notifications", s.authMember(s.handleUpdateMemberNotifications))
	m.HandleFunc("POST /api/v1/member/notifications/test", s.authMember(s.handleTestMemberNotification))
	m.HandleFunc("GET /api/v1/accounts", s.authMember(s.handleListAccounts))
	m.HandleFunc("POST /api/v1/accounts", s.authMember(s.handleCreateAccount))
	m.HandleFunc("DELETE /api/v1/accounts/{id}", s.authMember(s.handleDeleteAccount))
	m.HandleFunc("POST /api/v1/accounts/{id}/binding-url", s.authMember(s.handleRebindDANA))
	// Reversal DANA (v43): teruskan callback redirect OAuth ke Connecta.
	m.HandleFunc("POST /api/v1/accounts/dana/reversal", s.authMember(s.handleDanaReversal))
	// Profil DANA (v45): cek profil rekening DANA milik member sendiri.
	m.HandleFunc("POST /api/v1/accounts/{id}/dana-profile", s.authMember(s.handleDanaProfile))
	// Sinkron member (v46): sync manual satu rekening milik member.
	m.HandleFunc("POST /api/v1/accounts/{id}/sync", s.authMember(s.handleMemberSyncAccount))
	m.HandleFunc("GET /api/v1/mutasi", s.handleMutasi) // session OR api-key auth
	m.HandleFunc("GET /api/v1/banks", s.authMember(s.handleBankCodes))
	m.HandleFunc("POST /api/v1/inquiry/bank-account", s.authMember(s.handleBankInquiry))
	m.HandleFunc("GET /api/v1/inquiry/usage", s.authMember(s.handleInquiryUsage))
	m.HandleFunc("GET /api/v1/api-keys", s.authMember(s.handleListAPIKeys))
	m.HandleFunc("POST /api/v1/api-keys", s.authMember(s.handleCreateAPIKey))
	m.HandleFunc("DELETE /api/v1/api-keys/{id}", s.authMember(s.handleDeleteAPIKey))
	m.HandleFunc("GET /api/v1/plans", s.handlePlans)
	m.HandleFunc("GET /api/v1/subscriptions", s.authMember(s.handleListSubscriptions))
	m.HandleFunc("POST /api/v1/subscriptions", s.authMember(s.handleCreateSubscription))
	m.HandleFunc("POST /api/v1/subscriptions/{id}/pay-gobiz", s.authMember(s.handlePayGobiz))
	m.HandleFunc("POST /api/v1/gobiz/callback", s.handleGobizCallback)

	// Admin.
	m.HandleFunc("POST /api/v1/admin/login", s.handleAdminLogin)
	m.HandleFunc("GET /api/v1/admin/me", s.authAdmin(s.handleAdminMe))
	m.HandleFunc("GET /api/v1/admin/plans", s.authAdmin(s.handleAdminListPlans))
	m.HandleFunc("POST /api/v1/admin/plans", s.authAdmin(s.handleAdminCreatePlan))
	m.HandleFunc("PUT /api/v1/admin/plans/{id}", s.authAdmin(s.handleAdminUpdatePlan))
	m.HandleFunc("DELETE /api/v1/admin/plans/{id}", s.authAdmin(s.handleAdminDeletePlan))
	m.HandleFunc("GET /api/v1/admin/members", s.authAdmin(s.handleAdminListMembers))
	m.HandleFunc("GET /api/v1/admin/members/{id}", s.authAdmin(s.handleAdminGetMember))
	m.HandleFunc("GET /api/v1/admin/accounts", s.authAdmin(s.handleAdminListAccounts))
	m.HandleFunc("GET /api/v1/admin/accounts/{id}", s.authAdmin(s.handleAdminGetAccount))
	m.HandleFunc("POST /api/v1/admin/accounts/{id}/sync", s.authAdmin(s.handleAdminSyncAccount))
	m.HandleFunc("PUT /api/v1/admin/members/{id}", s.authAdmin(s.handleAdminUpdateMember))
	m.HandleFunc("POST /api/v1/admin/members/{id}/reset-password", s.authAdmin(s.handleAdminResetMemberPassword))
	m.HandleFunc("GET /api/v1/admin/settings", s.authAdmin(s.handleAdminGetSettings))
	m.HandleFunc("PUT /api/v1/admin/settings", s.authAdmin(s.handleAdminUpdateSettings))
	m.HandleFunc("POST /api/v1/admin/email/test", s.authAdmin(s.handleAdminTestEmail))
	m.HandleFunc("GET /api/v1/admin/announcements", s.authAdmin(s.handleAdminListAnnouncements))
	m.HandleFunc("POST /api/v1/admin/announcements", s.authAdmin(s.handleAdminCreateAnnouncement))
	m.HandleFunc("POST /api/v1/admin/announcements/{id}/send", s.authAdmin(s.handleAdminSendAnnouncement))
	m.HandleFunc("GET /api/v1/admin/email-templates", s.authAdmin(s.handleAdminListEmailTemplates))
	m.HandleFunc("GET /api/v1/admin/email-templates/{key}", s.authAdmin(s.handleAdminGetEmailTemplate))
	m.HandleFunc("PUT /api/v1/admin/email-templates/{key}", s.authAdmin(s.handleAdminUpdateEmailTemplate))
	m.HandleFunc("POST /api/v1/admin/email-templates/{key}/reset", s.authAdmin(s.handleAdminResetEmailTemplate))
	m.HandleFunc("POST /api/v1/admin/email-templates/{key}/preview", s.authAdmin(s.handleAdminPreviewEmailTemplate))
	m.HandleFunc("POST /api/v1/admin/email-templates/{key}/test", s.authAdmin(s.handleAdminTestEmailTemplate))
	m.HandleFunc("GET /api/v1/admin/audit-logs", s.authAdmin(s.handleAdminAuditLogs))
	m.HandleFunc("GET /api/v1/admin/connecta/webhook", s.authAdmin(s.handleAdminConnectaWebhookStatus))
	m.HandleFunc("GET /api/v1/admin/connecta/quota", s.authAdmin(s.handleAdminQuota))
	m.HandleFunc("GET /api/v1/admin/connecta/banks", s.authAdmin(s.handleAdminBankCodes))
	m.HandleFunc("POST /api/v1/admin/connecta/test", s.authAdmin(s.handleAdminConnectaTest))
	m.HandleFunc("GET /api/v1/admin/sync-status", s.authAdmin(s.handleAdminSyncStatus))
	m.HandleFunc("POST /api/v1/admin/connecta/dana/account-inquiry", s.authAdmin(s.handleAdminDanaInquiry))

	// Connecta inbound webhook.
	m.HandleFunc("POST /webhooks/connecta", s.handleConnectaWebhook)
}

// --- helpers ---

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"db":     s.store.Available(),
		"time":   formatWIB(time.Now()),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": code, "message": msg})
}

// parseUnknownField extracts the field name from a Go json error like
// `json: unknown field "bogus_field"`; "" when the error is not that kind.
func parseUnknownField(err error) string {
	msg := err.Error()
	const prefix = `json: unknown field "`
	if i := strings.Index(msg, prefix); i >= 0 {
		rest := msg[i+len(prefix):]
		if j := strings.Index(rest, `"`); j >= 0 {
			return rest[:j]
		}
	}
	return ""
}

// friendlyJSONError maps a json.Decode error to a generic Indonesian
// message (P2-4): never leak Go/library internals to the client. The
// raw error is returned alongside so callers can log it server-side.
func friendlyJSONError(err error) string {
	if f := parseUnknownField(err); f != "" {
		return "field tidak dikenal: " + f
	}
	return "body JSON tidak valid"
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		log.Printf("http: readJSON decode gagal: %v", err)
		writeErr(w, http.StatusBadRequest, "invalid_json", friendlyJSONError(err))
		return false
	}
	// P2-3: Decode kedua harus EOF — JSON ganda / trailing garbage
	// (mis. `{"a":1} {"a":1}`) ditolak 400, bukan diterima diam-diam.
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			log.Printf("http: readJSON: trailing JSON setelah objek pertama")
		} else {
			log.Printf("http: readJSON trailing decode gagal: %v", err)
		}
		writeErr(w, http.StatusBadRequest, "invalid_json", "body JSON tidak valid: hanya satu objek JSON yang diizinkan")
		return false
	}
	return true
}

// requireDB answers 503 when no database is attached.
func (s *Server) requireDB(w http.ResponseWriter) bool {
	if !s.store.Available() {
		writeErr(w, http.StatusServiceUnavailable, "db_unavailable",
			"database belum terkonfigurasi (set MYSQL_DSN lalu restart server)")
		return false
	}
	return true
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// clientIP returns the caller IP. X-Forwarded-For is trusted only when
// the direct peer (RemoteAddr) is loopback or a private address — i.e.
// our own nginx reverse proxy. A client connecting directly must not be
// able to spoof its IP (and bypass IP-based rate limits) via XFF.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	return host
}

func memberID(r *http.Request) (string, bool) {
	v, ok := r.Context().Value(ctxMemberID).(string)
	return v, ok && v != ""
}

func adminID(r *http.Request) (string, bool) {
	v, ok := r.Context().Value(ctxAdminID).(string)
	return v, ok && v != ""
}

func (s *Server) setSession(w http.ResponseWriter, subject, role string) error {
	tok, err := newSessionToken(s.jwtSecret(), subject, role, s.sessionVersion(subject, role))
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: "mh_session", Value: tok, Path: "/", HttpOnly: true, Secure: true,
		// P2-18: host-only — tanpa Domain, cookie tidak dikirim ke
		// subdomain lain (dulu Domain=.rajacek.com).
		SameSite: http.SameSiteLaxMode, MaxAge: 24 * 3600,
	})
	// Hapus cookie warisan pra-v22 (Domain=.rajacek.com) bila masih ada
	// di browser — cookie itu scope-nya berbeda sehingga tidak tertimpa
	// oleh cookie host-only di atas, dan bila terkirim duluan bisa
	// menutupi sesi yang sah (lihat validSessionClaims). Ini cookie
	// PENGHAPUSAN (MaxAge -1, tanpa nilai), bukan sesi — tidak
	// menghidupkan lagi sesi lintas-subdomain.
	http.SetCookie(w, &http.Cookie{
		Name: "mh_session", Value: "", Path: "/", Domain: ".rajacek.com",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	return nil
}

// sessionVersion reads the current session_version for a member/admin
// (0 bila DB tidak tersedia / kolom belum ada — token lama juga sv=0).
// bumpSessionVersion menaikkan versi sehingga SEMUA sesi subjek itu mati
// (dipakai saat logout, ganti sandi, reset sandi admin — P1-2).
func (s *Server) sessionVersion(subject, role string) int {
	if !s.store.Available() {
		return 0
	}
	table := "members"
	if role == "admin" {
		table = "admin_users"
	}
	var sv int
	if err := s.store.DB.QueryRowContext(context.Background(),
		`SELECT COALESCE(session_version,0) FROM `+table+` WHERE id=?`, subject).Scan(&sv); err != nil {
		return 0
	}
	return sv
}

func (s *Server) bumpSessionVersion(r *http.Request, subject, role string) {
	if !s.store.Available() {
		return
	}
	table := "members"
	if role == "admin" {
		table = "admin_users"
	}
	_, _ = s.store.DB.ExecContext(r.Context(),
		`UPDATE `+table+` SET session_version=session_version+1 WHERE id=?`, subject)
}

func (s *Server) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: "mh_session", Value: "", Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	// Bersihkan juga scope warisan pra-v22 (lihat setSession).
	http.SetCookie(w, &http.Cookie{
		Name: "mh_session", Value: "", Path: "/", Domain: ".rajacek.com",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// cookieDomain selalu "" (host-only) — P2-18: cookie sesi MutasiHub
// tidak boleh dikirim ke subdomain rajacek.com lain. COOKIE_DOMAIN di
// env sengaja diabaikan; bila lintas-subdomain dibutuhkan lagi, putuskan
// eksplisit dan ubah fungsi ini (bukan lewat env diam-diam).
func (s *Server) cookieDomain() string {
	return ""
}

// jwtSecret mengembalikan secret penandatangan sesi. Bila JWT_SECRET
// kosong, fallback di-generate SEKALI per proses (sync.Once) dan dipakai
// SAMA untuk sign (newSessionToken) maupun validate (ValidateJWT) —
// P2-18: dulu newSessionToken memakai secret acak per panggilan
// sementara ValidateJWT memakai cfg mentah, sehingga sesi tidak pernah
// bisa divalidasi bila secret kosong.
var (
	jwtFallbackSecret string
	jwtFallbackOnce   sync.Once
)

func (s *Server) jwtSecret() string {
	if s.cfg.JWTSecret != "" {
		return s.cfg.JWTSecret
	}
	jwtFallbackOnce.Do(func() {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		jwtFallbackSecret = hex.EncodeToString(b)
		log.Printf("http: JWT_SECRET kosong — memakai secret fallback per-proses (sesi tidak bertahan restart)")
	})
	return jwtFallbackSecret
}

// --- OAuth state yang ditandatangani server (P2-19) ---
//
// Peran Google callback TIDAK lagi dibaca dari cookie klien
// mh_oauth_role. State = base64url(role + "." + nonce) + "." +
// base64url(HMAC-SHA256(role + "." + nonce, jwtSecret)); nonce juga
// disimpan di cookie HttpOnly mh_oauth_state dan harus cocok di
// callback. Jalur admin tetap HANYA lewat allowlist
// ADMIN_GOOGLE_EMAILS (IsAdminGoogleEmail) — state yang ditandatangani
// hanya memilih jalur, bukan memberi hak admin.

func makeOAuthState(secret, role string) (state, nonce string, err error) {
	if role != "admin" {
		role = "member"
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	nonce = hex.EncodeToString(b)
	raw := role + "." + nonce
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(raw))
	sig := mac.Sum(nil)
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(raw)) + "." + enc(sig), nonce, nil
}

func verifyOAuthState(secret, state, nonce string) (role string, ok bool) {
	parts := strings.Split(state, ".")
	if len(parts) != 2 || nonce == "" {
		return "", false
	}
	enc := base64.RawURLEncoding
	rawBytes, err := enc.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	sig, err := enc.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBytes)
	if !hmac.Equal(mac.Sum(nil), sig) {
		return "", false
	}
	raw := string(rawBytes)
	role, n, found := strings.Cut(raw, ".")
	if !found || n != nonce || (role != "member" && role != "admin") {
		return "", false
	}
	return role, true
}

// maybeRefreshSession implements sliding refresh (P2-18): pada request
// terautentikasi, bila sisa TTL sesi < 12 jam, cookie sesi di-issue
// ulang dengan exp baru (24 jam dari sekarang). TIDAK dipakai untuk
// jalur API key (stateless, tanpa cookie).
func (s *Server) maybeRefreshSession(w http.ResponseWriter, claims *auth.Claims) {
	if claims == nil {
		return
	}
	if time.Until(time.Unix(claims.ExpiresAt, 0)) < 12*time.Hour {
		_ = s.setSession(w, claims.Subject, claims.Role)
	}
}

func (s *Server) audit(r *http.Request, actorType, actorID, action, detail string) {
	// P2-6: audit_logs tidak boleh berisi PII mentah — bila actor_id
	// masih berupa email (jalur lama / pemanggil lupa masking), ganti
	// dengan hash SHA-256-nya (64 hex, muat di VARCHAR(64)).
	if strings.Contains(actorID, "@") {
		actorID = sha256Hex(strings.ToLower(strings.TrimSpace(actorID)))
	}
	s.store.Audit(r.Context(), actorType, actorID, action, detail, clientIP(r))
}

// auditActorID returns a safe actor_id for audit rows: the member/admin
// id when known, otherwise the SHA-256 of the (lowercased) email —
// never the raw email (P2-6).
func auditActorID(knownID, email string) string {
	if knownID != "" {
		return knownID
	}
	return sha256Hex(strings.ToLower(strings.TrimSpace(email)))
}

// --- rate limiter (in-memory token bucket per key) ---

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter allows rate requests per minute per key.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

// NewLimiter creates a limiter.
func NewLimiter() *Limiter { return &Limiter{buckets: make(map[string]*bucket)} }

// Allow reports whether key may proceed at rate requests/minute.
func (l *Limiter) Allow(key string, rate float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: rate, last: now}
		l.buckets[key] = b
	}
	elapsed := now.Sub(b.last).Minutes()
	b.tokens += elapsed * rate
	if b.tokens > rate {
		b.tokens = rate
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Ensure imports used.
var _ = context.Background
var _ = fmt.Sprintf

// --- failed-auth limiter (5 failures / 15 minutes per key) ---
//
// Only failures are counted; a successful login/reset clears the key,
// so legitimate users are never blocked by their own earlier typos.

const (
	authFailMax    = 5
	authFailWindow = 15 * time.Minute
)

type failLimiter struct {
	mu    sync.Mutex
	fails map[string][]time.Time
}

func newFailLimiter() *failLimiter { return &failLimiter{fails: make(map[string][]time.Time)} }

// pruneLocked drops entries older than the window; caller holds mu.
func (f *failLimiter) pruneLocked(key string, now time.Time) []time.Time {
	kept := f.fails[key][:0]
	for _, t := range f.fails[key] {
		if now.Sub(t) < authFailWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(f.fails, key)
		return nil
	}
	f.fails[key] = kept
	return kept
}

// tooMany reports whether key already hit the failure budget.
func (f *failLimiter) tooMany(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pruneLocked(key, time.Now())) >= authFailMax
}

// record adds one failure for key.
func (f *failLimiter) record(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	f.pruneLocked(key, now)
	f.fails[key] = append(f.fails[key], now)
}

// reset clears all failures for key (called on success).
func (f *failLimiter) reset(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.fails, key)
}

// --- rolling-window limiter (N kejadian / window per key) ---
//
// Dipakai untuk register & forgot-password (P1-15): 5/jam/IP. Token
// bucket yang ada (Limiter) hanya bisa menyatakan laju per menit, dan
// failLimiter hanya menghitung kegagalan — keduanya tidak bisa
// menyatakan "5 per jam" untuk semua percobaan.

type rateWindow struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func newRateWindow(max int, window time.Duration) *rateWindow {
	return &rateWindow{max: max, window: window, hits: make(map[string][]time.Time)}
}

// allow mencatat satu kejadian untuk key dan melaporkan apakah masih
// dalam budget (false = sudah mencapai max dalam window berjalan).
func (w *rateWindow) allow(key string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := time.Now()
	kept := w.hits[key][:0]
	for _, t := range w.hits[key] {
		if now.Sub(t) < w.window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= w.max {
		w.hits[key] = kept
		return false
	}
	w.hits[key] = append(kept, now)
	return true
}

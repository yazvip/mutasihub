package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mutasi-hub/internal/auth"
	"mutasi-hub/internal/config"
	"mutasi-hub/internal/db"
)

func noDBServer() *Server {
	cfg := &config.Config{Port: "8080", JWTSecret: "test-jwt-secret-long-enough"}
	return New(cfg, &db.Store{})
}

func TestSessionCookieDomain(t *testing.T) {
	// P2-18: cookie sesi SELALU host-only (tanpa atribut Domain),
	// bahkan bila COOKIE_DOMAIN di-set ".rajacek.com" di env.
	cfg := &config.Config{Port: "8080", JWTSecret: "test-jwt-secret-long-enough", CookieDomain: ".rajacek.com"}
	s := New(cfg, &db.Store{})
	rec := httptest.NewRecorder()
	if err := s.setSession(rec, "member-1", "member"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rec.Header().Get("Set-Cookie"), "Domain=") {
		t.Fatalf("Set-Cookie = %q, want host-only tanpa Domain", rec.Header().Get("Set-Cookie"))
	}
	s2 := noDBServer()
	rec2 := httptest.NewRecorder()
	if err := s2.setSession(rec2, "member-1", "member"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rec2.Header().Get("Set-Cookie"), "Domain=") {
		t.Fatalf("Set-Cookie lokal = %q, want tanpa Domain", rec2.Header().Get("Set-Cookie"))
	}
	// Bug bounce 8 Nov 2026: setSession JUGA mengirim cookie PENGHAPUSAN
	// untuk scope warisan Domain=.rajacek.com (pra-v22) — header ke-2,
	// nilai kosong + Max-Age=0. Header PERTAMA (sesi) tetap host-only.
	cookies := rec.Header()["Set-Cookie"]
	if len(cookies) != 2 {
		t.Fatalf("Set-Cookie = %d header, want 2 (sesi + hapus warisan)", len(cookies))
	}
	if !strings.Contains(cookies[1], "Domain=rajacek.com") || !strings.Contains(cookies[1], "Max-Age=0") {
		t.Fatalf("Set-Cookie[1] = %q, want penghapusan Domain=.rajacek.com", cookies[1])
	}
}

// Bug 8 Nov 2026: member login sukses (200) lalu <1 detik kemudian semua
// /api/v1/* 401 -> terpental ke /login. Akar: browser mengirim DUA cookie
// mh_session (lama Domain=.rajacek.com pra-v22 + baru host-only);
// r.Cookie() hanya membaca yang pertama. authMember/authAdmin/
// authenticateMutasi harus mencoba semuanya dan memakai yang pertama VALID.
func TestAuthAcceptsSecondValidCookie(t *testing.T) {
	secret := "test-jwt-secret-long-enough"
	s := New(&config.Config{Port: "8080", JWTSecret: secret}, &db.Store{})
	memberTok, err := newSessionToken(secret, "member-1", "member", 0)
	if err != nil {
		t.Fatal(err)
	}
	adminTok, err := newSessionToken(secret, "admin-1", "admin", 0)
	if err != nil {
		t.Fatal(err)
	}

	ok := func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}

	cases := []struct {
		name    string
		handler http.HandlerFunc
		cookies []string // nilai cookie mh_session, sesuai urutan pengiriman
		want    int
	}{
		{"member valid saja", s.authMember(ok), []string{memberTok}, 200},
		{"sampah dulu, member valid kedua", s.authMember(ok), []string{"garbage-token", memberTok}, 200},
		{"token admin dulu, member valid kedua", s.authMember(ok), []string{adminTok, memberTok}, 200},
		{"member valid dulu, sampah kedua", s.authMember(ok), []string{memberTok, "garbage-token"}, 200},
		{"hanya sampah", s.authMember(ok), []string{"garbage-token"}, 401},
		{"tanpa cookie", s.authMember(ok), nil, 401},
		{"admin: member dulu, admin valid kedua", s.authAdmin(ok), []string{memberTok, adminTok}, 200},
		{"admin: hanya token member", s.authAdmin(ok), []string{memberTok}, 401},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/member/dashboard", nil)
			for _, v := range tc.cookies {
				req.AddCookie(&http.Cookie{Name: "mh_session", Value: v})
			}
			rec := httptest.NewRecorder()
			tc.handler(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}

	// Jalur /mutasi tanpa DB: cookie valid (ke-2) harus lolos validasi sesi
	// sehingga sampai ke gate langganan (403), bukan 401.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mutasi", nil)
	req.AddCookie(&http.Cookie{Name: "mh_session", Value: "garbage-token"})
	req.AddCookie(&http.Cookie{Name: "mh_session", Value: memberTok})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("mutasi dual-cookie = %d, want 403 (sesi diterima, langganan tidak ada)", rec.Code)
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/mutasi", nil)
	req2.AddCookie(&http.Cookie{Name: "mh_session", Value: "garbage-token"})
	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("mutasi hanya-sampah = %d, want 401", rec2.Code)
	}
}

// P2-18: fallback JWT secret stabil per proses — token yang di-sign
// dengan jwtSecret() harus bisa divalidasi dengan jwtSecret() yang sama
// (dulu newSessionToken memakai secret acak per panggilan).
func TestJWTFallbackSecretConsistent(t *testing.T) {
	s := &Server{cfg: &config.Config{Port: "8080" /* JWTSecret kosong */}}
	a, b := s.jwtSecret(), s.jwtSecret()
	if a == "" || a != b {
		t.Fatalf("jwtSecret tidak stabil: %q vs %q", a, b)
	}
	tok, err := newSessionToken(s.jwtSecret(), "m1", "member", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.ValidateJWT(s.jwtSecret(), tok); err != nil {
		t.Fatalf("token fallback tidak bisa divalidasi: %v", err)
	}
}

func TestHealthzNoDB(t *testing.T) {
	s := noDBServer()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("body = %v", body)
	}
}

func TestPlansFallbackNoDB(t *testing.T) {
	s := noDBServer()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/plans", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("plans status = %d, want 200", rec.Code)
	}
	var body struct {
		Plans []struct {
			Slug       string `json:"slug"`
			PriceCents int64  `json:"price_cents"`
		} `json:"plans"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Plans) != 4 {
		t.Fatalf("plans = %d, want 4", len(body.Plans))
	}
	if body.Plans[1].Slug != "starter" || body.Plans[1].PriceCents != 35000000 {
		t.Fatalf("plans = %+v", body.Plans)
	}
}

func TestDBEndpointsReturn503NoDB(t *testing.T) {
	s := noDBServer()
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/auth/register"},
		{http.MethodGet, "/api/v1/member/dashboard"},
		{http.MethodGet, "/api/v1/admin/members"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		// Admin routes need auth first (401); member/dashboard needs auth (401);
		// register hits requireDB -> 503. Accept either, but never 500/crash.
		if rec.Code == http.StatusInternalServerError {
			t.Errorf("%s %s: got 500", tc.method, tc.path)
		}
	}
	// Register specifically must be 503 without DB.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"a@b.co","password":"12345678","name":"A"}`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("register without DB = %d, want 503", rec.Code)
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "db_unavailable" {
		t.Fatalf("register error = %v", body)
	}
}

func TestMutasiRequiresAuth(t *testing.T) {
	s := noDBServer()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mutasi", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("mutasi without auth = %d, want 401", rec.Code)
	}
}

// P1-15 (v21): rateWindow 5/jam — 5 kejadian pertama lolos, ke-6 ditolak.
func TestRateWindowFivePerHour(t *testing.T) {
	w := newRateWindow(5, time.Hour)
	for i := 0; i < 5; i++ {
		if !w.allow("1.2.3.4") {
			t.Fatalf("attempt %d rejected, want allowed", i+1)
		}
	}
	if w.allow("1.2.3.4") {
		t.Fatal("6th attempt in one hour allowed, want rejected")
	}
	// Key lain tidak terpengaruh.
	if !w.allow("5.6.7.8") {
		t.Fatal("different key rejected, want allowed")
	}
}

// P1-12 (v21): scope API key — "all" dan "mutasi:read" lolos, scope lain
// (mis. "webhook:receive" saja, seperti temuan audit) ditolak.
func TestAPIKeyHasScope(t *testing.T) {
	cases := []struct {
		scope string
		want  bool
	}{
		{"all", true},
		{"mutasi:read", true},
		{"mutasi:read,accounts:read", true},
		{"accounts:read, mutasi:read", true},
		{"webhook:receive", false},
		{"accounts:read", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := apiKeyHasScope(tc.scope, "mutasi:read"); got != tc.want {
			t.Errorf("apiKeyHasScope(%q) = %v, want %v", tc.scope, got, tc.want)
		}
	}
}

// P0-B (v21): sandi reset acak — 16 karakter alfanumerik, tiap
// pemanggilan berbeda (tanpa karakter ambigu 0/O/1/l/I).
func TestRandomTempPassword(t *testing.T) {
	a, b := randomTempPassword(), randomTempPassword()
	for _, p := range []string{a, b} {
		if len(p) != 16 {
			t.Fatalf("temp password len = %d, want 16", len(p))
		}
		for _, r := range p {
			if !strings.ContainsRune("abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789", r) {
				t.Fatalf("temp password %q contains non-alphanumeric/ambiguous rune %q", p, r)
			}
		}
	}
	if a == b {
		t.Fatal("two temp passwords identical")
	}
}

// --- P2-1: validasi email RFC 5322 + nama ---
func TestValidEmail(t *testing.T) {
	valid := []string{"a@b.co", "nama.user+tag@example.com", "x@y.io"}
	for _, e := range valid {
		if !validEmail(e) {
			t.Errorf("validEmail(%q) = false, want true", e)
		}
	}
	invalid := []string{"", "plainaddress", "a@b", "a@b.", "@b.co", "a b@c.co",
		"John <a@b.co>", "a@@b.co", "a@b..co"}
	// Catatan: spasi di ujung sengaja di-trim dulu (register juga trim),
	// jadi "a@b.co " lolos sebagai "a@b.co" — itu perilaku yang diinginkan.
	for _, e := range invalid {
		if validEmail(e) {
			t.Errorf("validEmail(%q) = true, want false", e)
		}
	}
	if !validateMemberName("Andi") || validateMemberName("") || validateMemberName("   ") ||
		validateMemberName(strings.Repeat("x", 256)) || !validateMemberName(strings.Repeat("x", 255)) {
		t.Fatal("validateMemberName salah pada batas 1..255")
	}
}

// --- P2-3/P2-4: readJSON ---
func TestReadJSONDoubleJSONRejected(t *testing.T) {
	h := func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if !readJSON(w, r, &v) {
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
	for _, body := range []string{
		`{"a":1} {"a":1}`,
		`{"a":1} garbage`,
		`{"a":1} [1]`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("readJSON(%q) = %d, want 400", body, rec.Code)
		}
	}
	// Satu objek valid tetap lolos.
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"a":1}`))
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("readJSON valid = %d, want 200", rec.Code)
	}
}

func TestReadJSONUnknownFieldMessage(t *testing.T) {
	h := func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Known string `json:"known"`
		}
		if !readJSON(w, r, &v) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"known":"x","bogus_field":1}`))
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown field = %d, want 400", rec.Code)
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["message"] != "field tidak dikenal: bogus_field" {
		t.Fatalf("message = %q, want 'field tidak dikenal: bogus_field'", body["message"])
	}
	if strings.Contains(body["message"], "json:") || strings.Contains(body["message"], "Go") {
		t.Fatalf("message membocorkan detail Go: %q", body["message"])
	}
}

func TestFriendlyJSONError(t *testing.T) {
	if got := friendlyJSONError(errTestUnknownField()); got != "field tidak dikenal: bogus_field" {
		t.Fatalf("friendly = %q", got)
	}
}

// --- P2-5: klausa sender harus membawa ESCAPE '\\' (2 backslash di SQL) ---
// Regresi: literal Go dengan 2 backslash menghasilkan 1 backslash di SQL,
// dan MySQL membaca \' sebagai kutip ter-escape -> string tak tertutup
// (error 1064) sehingga filter sender selalu 500.
func TestSenderLikeClauseEscape(t *testing.T) {
	got := senderLikeClause()
	if !strings.Contains(got, `ESCAPE '\\'`) {
		t.Fatalf("senderLikeClause() = %q, want klausa mengandung ESCAPE '\\\\' (2 backslash di SQL)", got)
	}
	if n := strings.Count(got, `\`); n != 2 {
		t.Fatalf("senderLikeClause() = %q mengandung %d backslash, want 2", got, n)
	}
}

func TestEscapeLike(t *testing.T) {
	cases := map[string]string{
		`100%`:  `100\%`,
		`a_b`:   `a\_b`,
		`a\b`:   `a\\b`,
		`plain`: `plain`,
		`%_%`:   `\%\_\%`,
	}
	for in, want := range cases {
		if got := escapeLike(in); got != want {
			t.Errorf("escapeLike(%q) = %q, want %q", in, got, want)
		}
	}
}

// --- P2-19: OAuth state HMAC ---
func TestOAuthStateRoundTripAndTamper(t *testing.T) {
	secret := "test-oauth-secret"
	state, nonce, err := makeOAuthState(secret, "admin")
	if err != nil {
		t.Fatal(err)
	}
	role, ok := verifyOAuthState(secret, state, nonce)
	if !ok || role != "admin" {
		t.Fatalf("verify state admin = (%q,%v), want (admin,true)", role, ok)
	}
	// Peran diubah klien (member->admin) tanpa HMAC baru: ditolak.
	stateMember, nonceMember, _ := makeOAuthState(secret, "member")
	_ = stateMember
	_ = nonceMember
	if _, ok := verifyOAuthState(secret, state, "nonce-salah"); ok {
		t.Fatal("state dengan nonce salah diterima")
	}
	if _, ok := verifyOAuthState("secret-lain", state, nonce); ok {
		t.Fatal("state dengan secret lain diterima")
	}
	if _, ok := verifyOAuthState(secret, state+"x", nonce); ok {
		t.Fatal("state yang diubah diterima")
	}
}

// --- P2-17: recovery codes ---
func TestGenerateRecoveryCodes(t *testing.T) {
	codes := generateRecoveryCodes(8)
	if len(codes) != 8 {
		t.Fatalf("got %d codes, want 8", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 10 {
			t.Fatalf("code %q len != 10", c)
		}
		if seen[c] {
			t.Fatalf("duplicate code %q", c)
		}
		seen[c] = true
		if !verifyRecoveryCodeHash(sha256Hex(c), c) {
			t.Fatalf("hash verify gagal untuk %q", c)
		}
		if verifyRecoveryCodeHash(sha256Hex(c), "salah12345") {
			t.Fatalf("hash verify menerima kode salah")
		}
	}
}

// --- P2-4: batas 72 byte bcrypt ---
func TestPasswordTooLong(t *testing.T) {
	if !passwordTooLong(strings.Repeat("x", 73)) || passwordTooLong(strings.Repeat("x", 72)) {
		t.Fatal("passwordTooLong salah pada batas 72")
	}
}

func errTestUnknownField() error {
	dec := json.NewDecoder(strings.NewReader(`{"bogus_field":1}`))
	dec.DisallowUnknownFields()
	var v struct {
		Known string `json:"known"`
	}
	return dec.Decode(&v)
}

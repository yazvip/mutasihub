package http

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mutasi-hub/internal/connecta"
	"mutasi-hub/internal/domain"
)

func intPtr(v int) *int { return &v }

// --- (a) Tanggal WIB, termasuk batas 23:59 -> 00:00 ---
//
// Waktu di-inject (bukan jam sistem): server berjalan di CST (UTC+8),
// jadi batas hari WIB adalah 17:00 UTC, bukan 00:00 UTC.
func TestWIBTodayBoundary(t *testing.T) {
	cases := []struct {
		in   time.Time
		want string
	}{
		// 23:59:59 WIB 7 Nov = 16:59:59 UTC 7 Nov.
		{time.Date(2026, 11, 7, 16, 59, 59, 0, time.UTC), "2026-11-07"},
		// 00:00:00 WIB 8 Nov = 17:00:00 UTC 7 Nov — hari sudah berganti.
		{time.Date(2026, 11, 7, 17, 0, 0, 0, time.UTC), "2026-11-08"},
		// Satu detik sebelum tengah malam WIB.
		{time.Date(2026, 11, 7, 16, 59, 59, 999999999, time.UTC), "2026-11-07"},
		// Tengah hari WIB.
		{time.Date(2026, 11, 7, 5, 0, 0, 0, time.UTC), "2026-11-07"},
		// 00:00 UTC = 07:00 WIB hari yang sama.
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2026-01-01"},
		// Pergantian bulan: 23:59 WIB 30 Nov -> 00:00 WIB 1 Des.
		{time.Date(2026, 11, 30, 16, 59, 59, 0, time.UTC), "2026-11-30"},
		{time.Date(2026, 11, 30, 17, 0, 0, 0, time.UTC), "2026-12-01"},
	}
	for _, tc := range cases {
		if got := wibToday(tc.in); got != tc.want {
			t.Errorf("wibToday(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestNextWIBMidnight(t *testing.T) {
	cases := []struct {
		in   time.Time
		want string // formatWIB dari hasilnya
	}{
		// 23:30 WIB 7 Nov -> 00:00 WIB 8 Nov.
		{time.Date(2026, 11, 7, 16, 30, 0, 0, time.UTC), "2026-11-08T00:00:00+07:00"},
		// Tepat 00:00 WIB 8 Nov -> reset berikutnya 00:00 WIB 9 Nov.
		{time.Date(2026, 11, 7, 17, 0, 0, 0, time.UTC), "2026-11-09T00:00:00+07:00"},
		// Siang WIB -> tengah malam yang sama (awal hari berikutnya).
		{time.Date(2026, 11, 7, 5, 0, 0, 0, time.UTC), "2026-11-08T00:00:00+07:00"},
	}
	for _, tc := range cases {
		got := formatWIB(nextWIBMidnight(tc.in))
		if got != tc.want {
			t.Errorf("nextWIBMidnight(%v) = %q, want %q", tc.in, got, tc.want)
		}
		if !strings.HasSuffix(got, "+07:00") {
			t.Errorf("resets_at %q tidak berzona +07:00", got)
		}
	}
}

// --- (b) Logika gate limit harian ---
func TestInquiryLimitRemaining(t *testing.T) {
	cases := []struct {
		name      string
		limit     *int
		used      int
		wantAllow bool
		wantRem   *int
	}{
		{"tanpa batas (nil), used 0", nil, 0, true, nil},
		{"tanpa batas (nil), used 9999", nil, 9999, true, nil},
		{"limit 5, used 0", intPtr(5), 0, true, intPtr(5)},
		{"limit 5, used 4", intPtr(5), 4, true, intPtr(1)},
		{"limit 5, used 5 (pas)", intPtr(5), 5, false, intPtr(0)},
		{"limit 5, used 7 (limit diturunkan admin)", intPtr(5), 7, false, intPtr(0)},
		{"limit 0, used 0 (tidak ada hit diizinkan)", intPtr(0), 0, false, intPtr(0)},
		{"limit 1, used 0", intPtr(1), 0, true, intPtr(1)},
		{"limit 1, used 1", intPtr(1), 1, false, intPtr(0)},
	}
	for _, tc := range cases {
		allow, rem := inquiryLimitRemaining(tc.limit, tc.used)
		if allow != tc.wantAllow {
			t.Errorf("%s: allowed = %v, want %v", tc.name, allow, tc.wantAllow)
		}
		if (rem == nil) != (tc.wantRem == nil) || (rem != nil && *rem != *tc.wantRem) {
			t.Errorf("%s: remaining = %v, want %v", tc.name, rem, tc.wantRem)
		}
		if rem != nil && *rem < 0 {
			t.Errorf("%s: remaining negatif %d", tc.name, *rem)
		}
	}
}

// --- (c) Increment atomik tidak melewati limit ---
//
// Tidak ada MySQL lokal di repo ini (semua tes handler memakai pola
// noDBServer / pure function), jadi keputusan increment diuji lewat
// fungsi pure-nya + asersi bentuk SQL pengunciannya. Verifikasi
// end-to-end terhadap MySQL nyata (termasuk dua transaksi bersamaan
// pada limit 1) masih harus dilakukan agen deploy di staging:
// dua inquiry bersamaan dengan sisa kuota 1 harus menghasilkan satu
// sukses + satu 429, dan used akhir harus 1, bukan 2.
func TestInquiryIncrementDecision(t *testing.T) {
	cases := []struct {
		name      string
		limit     *int
		rowExists bool
		used      int
		wantAct   inquiryIncrementAction
		wantUsed  int
	}{
		{"tanpa batas, baris baru", nil, false, 0, incrementInsert, 1},
		{"tanpa batas, baris ada used 41", nil, true, 41, incrementUpdate, 42},
		{"limit 5, baris baru", intPtr(5), false, 0, incrementInsert, 1},
		{"limit 5, used 4 -> update ke 5", intPtr(5), true, 4, incrementUpdate, 5},
		{"limit 5, used 5 -> ditolak, tetap 5", intPtr(5), true, 5, incrementReached, 5},
		{"limit 5, used 7 (limit diturunkan) -> ditolak, tetap 7", intPtr(5), true, 7, incrementReached, 7},
		{"limit 1, baris baru -> insert", intPtr(1), false, 0, incrementInsert, 1},
		{"limit 1, used 1 -> ditolak (balapan sisa kuota terakhir)", intPtr(1), true, 1, incrementReached, 1},
		{"limit 0, baris baru -> ditolak, baris jangan dibuat", intPtr(0), false, 0, incrementReached, 0},
		{"limit 0, baris ada -> ditolak", intPtr(0), true, 0, incrementReached, 0},
	}
	for _, tc := range cases {
		act, used := inquiryIncrementDecision(tc.limit, tc.rowExists, tc.used)
		if act != tc.wantAct || used != tc.wantUsed {
			t.Errorf("%s: got (action=%v, used=%d), want (action=%v, used=%d)",
				tc.name, act, used, tc.wantAct, tc.wantUsed)
		}
		// Invariant utama: aksi yang MENULIS (insert/update) tidak pernah
		// membuat used melewati limit. Aksi reached mengembalikan used
		// apa adanya — bisa di atas limit bila admin menurunkan limit
		// di tengah hari — tapi tidak pernah menambahnya.
		if (act == incrementInsert || act == incrementUpdate) && tc.limit != nil && used > *tc.limit {
			t.Errorf("%s: newUsed %d melewati limit %d", tc.name, used, *tc.limit)
		}
		if act == incrementReached && used != tc.used {
			t.Errorf("%s: reached harus mengembalikan used apa adanya %d, got %d", tc.name, tc.used, used)
		}
	}
}

// SQL increment harus membaca dengan lock (FOR UPDATE) dan menaikkan
// secara relatif (used+1) — bukan SET absolut — supaya keputusan
// increment selalu atas nilai terkini yang terkunci.
func TestInquiryUsageSQLLocksRow(t *testing.T) {
	if !strings.Contains(inquiryUsageSelectSQL, "FOR UPDATE") {
		t.Fatalf("inquiryUsageSelectSQL = %q, want mengandung FOR UPDATE", inquiryUsageSelectSQL)
	}
	if !strings.Contains(inquiryUsageUpdateSQL, "used = used + 1") {
		t.Fatalf("inquiryUsageUpdateSQL = %q, want kenaikan relatif used = used + 1", inquiryUsageUpdateSQL)
	}
	if !strings.Contains(inquiryUsageInsertSQL, "VALUES (?, ?, 1)") {
		t.Fatalf("inquiryUsageInsertSQL = %q, want insert baris baru dengan used=1", inquiryUsageInsertSQL)
	}
}

// --- Bentuk respons 429 limit habis ---
func TestWriteInquiryLimitReached(t *testing.T) {
	rec := httptest.NewRecorder()
	writeInquiryLimitReached(rec, intPtr(10))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "inquiry_limit_reached" {
		t.Fatalf("error = %v", body["error"])
	}
	if body["limit_today"] != float64(10) || body["remaining_today"] != float64(0) {
		t.Fatalf("body = %v, want limit_today=10 remaining_today=0", body)
	}
	// Tanpa batas: limit_today null, remaining tetap 0.
	rec2 := httptest.NewRecorder()
	writeInquiryLimitReached(rec2, nil)
	var body2 map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&body2)
	if body2["limit_today"] != nil {
		t.Fatalf("limit_today tanpa batas = %v, want null", body2["limit_today"])
	}
}

// --- Helper nullable int (DB <-> domain <-> JSON) ---
func TestNullInt32ToPtrAndBack(t *testing.T) {
	if got := nullInt32ToPtr(sql.NullInt32{Valid: false}); got != nil {
		t.Fatalf("NULL -> %v, want nil", got)
	}
	got := nullInt32ToPtr(sql.NullInt32{Int32: 25, Valid: true})
	if got == nil || *got != 25 {
		t.Fatalf("25 -> %v, want 25", got)
	}
	if intPtrToDB(nil) != nil {
		t.Fatal("nil *int harus jadi NULL (nil any), bukan 0")
	}
	if intPtrToDB(intPtr(0)) != 0 {
		t.Fatalf("limit 0 harus tersimpan sebagai 0, bukan NULL: %v", intPtrToDB(intPtr(0)))
	}
	if nullableIntJSON(nil) != nil || nullableIntJSON(intPtr(3)) != 3 {
		t.Fatal("nullableIntJSON salah")
	}
}

// --- Audit detail plan_update mencatat perubahan inquiry_limit ---
func TestPlanUpdateDetailInquiryLimit(t *testing.T) {
	old := domain.Plan{Slug: "pro", Name: "Pro", InquiryLimit: nil}
	cur := domain.Plan{Slug: "pro", Name: "Pro", InquiryLimit: intPtr(100)}
	d := planUpdateDetail(old, cur)
	if !strings.Contains(d, "limit_inquiry: tanpa batas -> 100") {
		t.Fatalf("detail = %q, want mengandung 'limit_inquiry: tanpa batas -> 100'", d)
	}
	// Menghapus batas (100 -> null) juga tercatat.
	d2 := planUpdateDetail(cur, old)
	if !strings.Contains(d2, "limit_inquiry: 100 -> tanpa batas") {
		t.Fatalf("detail = %q, want mengandung 'limit_inquiry: 100 -> tanpa batas'", d2)
	}
	// Tidak berubah -> tidak ada entri limit_inquiry.
	if d3 := planUpdateDetail(old, old); strings.Contains(d3, "limit_inquiry") {
		t.Fatalf("detail tanpa perubahan = %q, tidak boleh menyebut limit_inquiry", d3)
	}
	if !inquiryLimitEqual(nil, nil) || inquiryLimitEqual(nil, intPtr(0)) ||
		!inquiryLimitEqual(intPtr(5), intPtr(5)) || inquiryLimitEqual(intPtr(5), intPtr(6)) {
		t.Fatal("inquiryLimitEqual salah (nil != 0, nil == nil, N == N)")
	}
}

// --- Perangkap null inquiry_limit di PUT plan (catatan agen frontend) ---
//
// encoding/json mengubah JSON null menjadi pointer nil, jadi *int/**int
// TIDAK bisa membedakan {"inquiry_limit":null} dari {} — null eksplisit
// akan diam-diam mempertahankan limit lama sementara admin mengira sudah
// "Tanpa batas". nullableIntField + flag Present menyelesaikan ini.
// Tes di bawah memakai readJSON (jalur decode handler yang sebenarnya).

func decodePlanUpdate(t *testing.T, body string) (planUpdateRequest, bool) {
	t.Helper()
	var req planUpdateRequest
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/plans/1", strings.NewReader(body))
	ok := readJSON(rec, r, &req)
	return req, ok
}

func TestPlanUpdateRequestInquiryLimitNull(t *testing.T) {
	// Field tidak dikirim -> Present=false (tidak diubah).
	req, ok := decodePlanUpdate(t, `{}`)
	if !ok || req.InquiryLimit.Present {
		t.Fatalf("body {} -> ok=%v Present=%v, want ok=true Present=false", ok, req.InquiryLimit.Present)
	}
	// null eksplisit -> Present=true, Value=nil (hapus batas).
	req, ok = decodePlanUpdate(t, `{"inquiry_limit":null}`)
	if !ok || !req.InquiryLimit.Present || req.InquiryLimit.Value != nil {
		t.Fatalf("body null -> ok=%v Present=%v Value=%v, want ok=true Present=true Value=nil",
			ok, req.InquiryLimit.Present, req.InquiryLimit.Value)
	}
	// Angka -> Present=true, Value=&n (termasuk 0).
	for _, tc := range []struct {
		body string
		want int
	}{
		{`{"inquiry_limit":100}`, 100},
		{`{"inquiry_limit":0}`, 0},
	} {
		req, ok = decodePlanUpdate(t, tc.body)
		if !ok || !req.InquiryLimit.Present || req.InquiryLimit.Value == nil || *req.InquiryLimit.Value != tc.want {
			t.Fatalf("body %s -> ok=%v Present=%v Value=%v, want Value=%d",
				tc.body, ok, req.InquiryLimit.Present, req.InquiryLimit.Value, tc.want)
		}
	}
	// Nilai bukan integer -> decode gagal (400 di handler).
	if _, ok := decodePlanUpdate(t, `{"inquiry_limit":"tanpa batas"}`); ok {
		t.Fatal(`{"inquiry_limit":"tanpa batas"} diterima, want decode gagal`)
	}
}

// Skenario frontend: set limit 100 -> simpan -> edit -> kosongkan
// (kirim null) -> simpan -> GET plans harus mengembalikan null, bukan 100.
func TestApplyPlanUpdateInquiryLimitRoundTrip(t *testing.T) {
	cur := domain.Plan{Slug: "pro", Name: "Pro", InquiryLimit: intPtr(100)}
	// Edit tanpa menyentuh inquiry_limit -> tetap 100.
	req, _ := decodePlanUpdate(t, `{"name":"Pro Baru"}`)
	if got := applyPlanUpdateRequest(cur, req); got.InquiryLimit == nil || *got.InquiryLimit != 100 {
		t.Fatalf("field tidak dikirim: limit = %v, want 100", got.InquiryLimit)
	}
	// Edit mengubah ke 50.
	req, _ = decodePlanUpdate(t, `{"inquiry_limit":50}`)
	if got := applyPlanUpdateRequest(cur, req); got.InquiryLimit == nil || *got.InquiryLimit != 50 {
		t.Fatalf("set 50: limit = %v, want 50", got.InquiryLimit)
	}
	// Edit mengosongkan (null) -> batas terhapus.
	req, _ = decodePlanUpdate(t, `{"inquiry_limit":null}`)
	if got := applyPlanUpdateRequest(cur, req); got.InquiryLimit != nil {
		t.Fatalf("kosongkan (null): limit = %v, want nil (tanpa batas)", got.InquiryLimit)
	}
	// Set 0 eksplisit -> 0, bukan nil (0 = tidak ada hit diizinkan).
	req, _ = decodePlanUpdate(t, `{"inquiry_limit":0}`)
	if got := applyPlanUpdateRequest(cur, req); got.InquiryLimit == nil || *got.InquiryLimit != 0 {
		t.Fatalf("set 0: limit = %v, want 0", got.InquiryLimit)
	}
	// Sisi baca: Plan tanpa batas di-marshal sebagai inquiry_limit null.
	raw, err := json.Marshal(domain.Plan{Slug: "pro", InquiryLimit: nil})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"inquiry_limit":null`) {
		t.Fatalf("marshal Plan tanpa batas = %s, want mengandung \"inquiry_limit\":null", raw)
	}
}

// Route usage terdaftar dan di belakang authMember (tanpa sesi -> 401,
// bukan 404).
func TestInquiryUsageRouteRequiresAuth(t *testing.T) {
	s := noDBServer()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/inquiry/usage", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/v1/inquiry/usage tanpa auth = %d, want 401", rec.Code)
	}
}

// --- (v28) Pemetaan error inquiry: provider error TIDAK BOLEH 502 ---
//
// Cloudflare mengganti body respons 502 dari origin dengan halaman error
// miliknya (HTML untuk browser, "error code: 502" untuk non-browser),
// sehingga pesan JSON ramah kami tidak pernah sampai ke member dan
// frontend malah menampilkan source HTML itu. 503 diteruskan utuh
// (terverifikasi live: 503 google_not_configured sampai sebagai JSON).
// Karena itu semua error provider dipetakan ke 503, bukan 502.
func TestClassifyInquiryErrorNever502(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			// Insiden 8 Nov 2026: Connecta redirect-loop (endpoint 301 ke
			// dirinya sendiri) — error transport, bukan HTTPError.
			// Kode tetap provider_error (seperti sebelumnya), hanya
			// status yang berubah 502 -> 503.
			name:       "redirect loop connecta",
			err:        fmt.Errorf(`connecta: POST /b2b/dana/account-inquiry: Post "https://connecta-crm.digitcodestudio.com/api/v1/b2b/dana/account-inquiry": stopped after 10 redirects`),
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "provider_error",
		},
		{
			name:       "error generik non-HTTP",
			err:        fmt.Errorf("connecta: dial tcp: connection refused"),
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "provider_error",
		},
		{
			name:       "sinyal gangguan sementara",
			err:        fmt.Errorf(`connecta: POST /b2b/dana/account-inquiry returned HTTP 400: {"error":"SERVICE_TEMPORARILY_UNAVAILABLE"}`),
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "provider_unavailable",
		},
		{
			name:       "upstream 500",
			err:        &connecta.HTTPError{Method: "POST", Path: "/b2b/dana/account-inquiry", Status: 500, Body: `{"error":"internal"}`},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "provider_unavailable",
		},
		{
			name:       "upstream 404 tetap 404",
			err:        &connecta.HTTPError{Method: "POST", Path: "/b2b/dana/account-inquiry", Status: 404, Body: `{"error":"not_found"}`},
			wantStatus: http.StatusNotFound,
			wantCode:   "inquiry_not_found",
		},
		{
			name:       "upstream 400 tetap 400",
			err:        &connecta.HTTPError{Method: "POST", Path: "/b2b/dana/account-inquiry", Status: 400, Body: `{"error":"bad_request"}`},
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_request",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, code, msg := classifyInquiryError(tc.err)
			if status == http.StatusBadGateway {
				t.Fatalf("classifyInquiryError = 502, dilarang v28 (Cloudflare mengganti body 502)")
			}
			if status != tc.wantStatus || code != tc.wantCode {
				t.Fatalf("classifyInquiryError = (%d, %q, %q), want (%d, %q)", status, code, msg, tc.wantStatus, tc.wantCode)
			}
			if strings.Contains(msg, "<") || strings.Contains(msg, "connecta") {
				t.Fatalf("pesan mengandung HTML/nama vendor: %q", msg)
			}
		})
	}
}

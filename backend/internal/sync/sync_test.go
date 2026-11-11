package sync

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"mutasi-hub/internal/connecta"
)

func TestMutationHashDeterministic(t *testing.T) {
	h1 := MutationHash("m1", "a1", "DANA", time.Date(2026, 11, 6, 10, 0, 0, 0, time.FixedZone("WIB", 7*3600)), "CR", 10000000, "Transfer dari Budi")
	h2 := MutationHash("m1", "a1", "DANA", time.Date(2026, 11, 6, 10, 0, 0, 0, time.FixedZone("WIB", 7*3600)), "CR", 10000000, "Transfer dari Budi")
	if h1 != h2 {
		t.Fatal("same mutation produced different hashes")
	}
	if len(h1) != 64 {
		t.Fatalf("hash length = %d, want 64 hex chars", len(h1))
	}
}

func TestMutationHashDiffersOnAnyField(t *testing.T) {
	d := time.Date(2026, 11, 6, 10, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	base := MutationHash("m1", "a1", "DANA", d, "CR", 10000000, "Transfer dari Budi")
	variants := []string{
		MutationHash("m2", "a1", "DANA", d, "CR", 10000000, "Transfer dari Budi"),
		MutationHash("m1", "a2", "DANA", d, "CR", 10000000, "Transfer dari Budi"),
		MutationHash("m1", "a1", "BCA", d, "CR", 10000000, "Transfer dari Budi"),
		MutationHash("m1", "a1", "DANA", d.Add(time.Second), "CR", 10000000, "Transfer dari Budi"),
		MutationHash("m1", "a1", "DANA", d, "DB", 10000000, "Transfer dari Budi"),
		MutationHash("m1", "a1", "DANA", d, "CR", 10000001, "Transfer dari Budi"),
		MutationHash("m1", "a1", "DANA", d, "CR", 10000000, "Transfer dari Andi"),
	}
	for i, v := range variants {
		if v == base {
			t.Fatalf("variant %d produced the same hash as base", i)
		}
	}
}

// Tanggal yang sama dalam format berbeda (naif WIB vs RFC3339 +07:00)
// harus menghasilkan hash yang sama; tanggal gagal parse ditolak.
func TestMutationHashDateNormalized(t *testing.T) {
	d1, ok1 := parseTxDate("2026-11-06 10:00:00")
	d2, ok2 := parseTxDate("2026-11-06T10:00:00+07:00")
	if !ok1 || !ok2 {
		t.Fatalf("parseTxDate ok = %v/%v, want true/true", ok1, ok2)
	}
	h1 := MutationHash("m1", "a1", "DANA", d1, "CR", 10000000, "Transfer dari Budi")
	h2 := MutationHash("m1", "a1", "DANA", d2, "CR", 10000000, "Transfer dari Budi")
	if h1 != h2 {
		t.Fatal("same instant in different formats produced different hashes")
	}
	if _, ok := parseTxDate("bukan tanggal"); ok {
		t.Fatal("parseTxDate accepted garbage")
	}
	if _, ok := parseTxDate(""); ok {
		t.Fatal("parseTxDate accepted empty date")
	}
}

// P2-8: signature HMAC-SHA256 atas body, format "sha256=<hex>".
func TestCallbackSignature(t *testing.T) {
	sig := callbackSignature("secret-1", `{"a":1}`)
	if !strings.HasPrefix(sig, "sha256=") || len(sig) != 7+64 {
		t.Fatalf("signature = %q, want sha256=+64 hex", sig)
	}
	if callbackSignature("secret-1", `{"a":1}`) != sig {
		t.Fatal("signature tidak deterministik")
	}
	if callbackSignature("secret-2", `{"a":1}`) == sig {
		t.Fatal("secret berbeda menghasilkan signature sama")
	}
	if callbackSignature("secret-1", `{"a":2}`) == sig {
		t.Fatal("body berbeda menghasilkan signature sama")
	}
}

// P2-9: filter BCA per account_no.
func TestFilterBCAMutations(t *testing.T) {
	txs := []connecta.BCAMutation{
		{AccountNo: "1234567890", Amount: 100},
		{AccountNo: "9999999999", Amount: 200},
		{Amount: 300}, // tanpa nomor: lolos (upstream tidak selalu menandai)
	}
	got := filterBCAMutations(txs, "1234567890")
	if len(got) != 2 {
		t.Fatalf("filtered = %d, want 2 (milik sendiri + tanpa nomor)", len(got))
	}
	for _, tx := range got {
		if tx.AccountNo == "9999999999" {
			t.Fatal("mutasi rekening lain lolos filter")
		}
	}
}

// v42a (Q7 + SSRF guard): hanya https; tolak IP literal privat/loopback/
// link-local (termasuk 169.254.169.254), userinfo, host kosong, dan
// hostname yang resolve ke alamat privat. lookupIP di-stub agar tes
// tidak menyentuh jaringan.
func TestValidateCallbackURL(t *testing.T) {
	ctx := context.Background()
	origLookup := lookupIP
	defer func() { lookupIP = origLookup }()

	publicIP := func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	privateIP := func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("10.1.2.3")}, nil
	}
	lookupErr := func(context.Context, string) ([]net.IP, error) {
		return nil, errors.New("no such host")
	}
	neverCalled := func(context.Context, string) ([]net.IP, error) {
		t.Fatal("lookupIP dipanggil untuk URL yang harus ditolak sebelum resolve")
		return nil, nil
	}

	cases := []struct {
		name   string
		url    string
		lookup func(context.Context, string) ([]net.IP, error)
		wantOK bool
	}{
		{"https publik ok", "https://example.com/hook", publicIP, true},
		{"https port eksplisit ok", "https://example.com:8443/hook", publicIP, true},
		{"IP publik literal ok", "https://8.8.8.8/hook", neverCalled, true},
		{"http ditolak", "http://example.com/hook", neverCalled, false},
		{"skema kosong ditolak", "example.com/hook", neverCalled, false},
		{"host kosong ditolak", "https:///hook", neverCalled, false},
		{"userinfo ditolak", "https://user:pass@example.com/hook", neverCalled, false},
		{"localhost ditolak", "https://localhost/hook", neverCalled, false},
		{"10/8 ditolak", "https://10.0.0.5/hook", neverCalled, false},
		{"192.168/16 ditolak", "https://192.168.1.1/hook", neverCalled, false},
		{"172.16/12 ditolak", "https://172.16.0.9/hook", neverCalled, false},
		{"127.0.0.1 ditolak", "https://127.0.0.1/hook", neverCalled, false},
		{"169.254.169.254 ditolak", "https://169.254.169.254/latest", neverCalled, false},
		{"169.254/16 ditolak", "https://169.254.10.20/hook", neverCalled, false},
		{"0.0.0.0 ditolak", "https://0.0.0.0/hook", neverCalled, false},
		{"::1 ditolak", "https://[::1]/hook", neverCalled, false},
		{"fd00::/8 ditolak", "https://[fd00::1]/hook", neverCalled, false},
		{"resolve ke privat ditolak", "https://example.com/hook", privateIP, false},
		{"resolve gagal ditolak", "https://tidak-ada.invalid/hook", lookupErr, false},
		{"terlalu panjang ditolak", "https://example.com/" + strings.Repeat("a", 600), neverCalled, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lookupIP = tc.lookup
			err := ValidateCallbackURL(ctx, tc.url)
			if tc.wantOK && err != nil {
				t.Fatalf("ValidateCallbackURL(%q) = %v, want nil", tc.url, err)
			}
			if !tc.wantOK && err == nil {
				t.Fatalf("ValidateCallbackURL(%q) = nil, want error", tc.url)
			}
		})
	}
}

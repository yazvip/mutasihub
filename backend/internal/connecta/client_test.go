package connecta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestClientSendsAPIKeyHeader(t *testing.T) {
	var gotKey, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-API-KEY")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"quota":100}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-key-123")
	if _, err := c.Quota(context.Background()); err != nil {
		t.Fatal(err)
	}
	if gotKey != "secret-key-123" {
		t.Fatalf("X-API-KEY = %q", gotKey)
	}
	if gotPath != "/b2b/quota" {
		t.Fatalf("path = %q, want /b2b/quota", gotPath)
	}
}

func TestClientRetries5xxOnly(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`bad gateway`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "k")
	if _, err := c.Docs(context.Background()); err != nil {
		t.Fatalf("expected success after 5xx retries: %v", err)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls = %d, want 3 (1 + 2 retries)", calls.Load())
	}
}

func TestClientNoRetryOn4xx(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`unauthorized`))
	}))
	defer srv.Close()

	c := New(srv.URL, "bad-key")
	if _, err := c.Quota(context.Background()); err == nil {
		t.Fatal("expected error on 401")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1 (no retry on 4xx)", calls.Load())
	}
}

func TestClientUnconfigured(t *testing.T) {
	c := New("", "")
	if _, err := c.Quota(context.Background()); err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected not-configured error, got %v", err)
	}
}

func TestDanaTransactionsParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("phone") != "081234567890" {
			t.Errorf("phone query = %q", r.URL.Query().Get("phone"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"date":"2026-11-06 10:00:00","type":"CR","amount":100000,"description":"Transfer","sender":"Budi"}]}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "k")
	txs, _, err := c.DanaTransactions(context.Background(), "081234567890", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(txs) != 1 || txs[0].Amount != 100000 || txs[0].Sender != "Budi" {
		t.Fatalf("txs = %+v", txs)
	}
}

func TestDanaReversalPublic(t *testing.T) {
	var calls atomic.Int32
	var gotKey, gotUA, gotCT, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		gotKey = r.Header.Get("X-API-KEY")
		gotUA = r.Header.Get("User-Agent")
		gotCT = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"account_id":"acc-1","status":"ACTIVE","phone_number":"08112311232","balance_amount":840}}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-key-123")
	raw, status, err := c.DanaReversal(context.Background(), "https://mutasi.rajacek.com/member/accounts?dana=callback&auth_code=CODE&state=STATE", "b2b-083135931670")
	if err != nil {
		t.Fatal(err)
	}
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	if gotKey != "" {
		t.Fatalf("X-API-KEY = %q, want empty (public endpoint)", gotKey)
	}
	if gotUA != "ConnectaWebhook/1.0" {
		t.Fatalf("User-Agent = %q, want ConnectaWebhook/1.0", gotUA)
	}
	if gotCT != "application/json" {
		t.Fatalf("Content-Type = %q", gotCT)
	}
	if !strings.Contains(gotBody, `"partner_id":"b2b-083135931670"`) {
		t.Fatalf("body = %s, want partner_id", gotBody)
	}
	// encoding/json meng-escape & menjadi \u0026 di string — parse JSON
	// untuk membandingkan nilai callback_url apa adanya.
	var body struct {
		CallbackURL string `json:"callback_url"`
		PartnerID   string `json:"partner_id"`
	}
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("body bukan JSON: %v (%s)", err, gotBody)
	}
	if body.CallbackURL != "https://mutasi.rajacek.com/member/accounts?dana=callback&auth_code=CODE&state=STATE" {
		t.Fatalf("callback_url = %q", body.CallbackURL)
	}
	if body.PartnerID != "b2b-083135931670" {
		t.Fatalf("partner_id = %q", body.PartnerID)
	}
	if !strings.Contains(string(raw), `"ACTIVE"`) {
		t.Fatalf("raw = %s", raw)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1 (single attempt)", calls.Load())
	}
}

func TestDanaReversalNoRetryOn5xx(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`bad gateway`))
	}))
	defer srv.Close()

	c := New(srv.URL, "k")
	if _, _, err := c.DanaReversal(context.Background(), "https://x/member/accounts?dana=callback&auth_code=C", "b2b-1"); err == nil {
		t.Fatal("expected error on 502")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1 (single attempt, no retry on 5xx)", calls.Load())
	}
}

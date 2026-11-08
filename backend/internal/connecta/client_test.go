package connecta

import (
	"context"
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

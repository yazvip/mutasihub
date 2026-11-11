package http

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	syncpkg "mutasi-hub/internal/sync"
)

// v40: helper murni daftar rekening — tanpa DB (pola repo: tidak ada sqlmock).

func TestAccountDisplayStatus(t *testing.T) {
	cases := []struct {
		db     string
		frozen bool
		want   string
	}{
		{"active", false, "active"},
		{"pending", false, "pending"},
		{"active", true, "frozen"},
		{"pending", true, "frozen"},
		{"Active", false, "active"},
		{"", false, ""},
	}
	for _, c := range cases {
		if got := accountDisplayStatus(c.db, c.frozen); got != c.want {
			t.Errorf("accountDisplayStatus(%q,%v) = %q, want %q", c.db, c.frozen, got, c.want)
		}
	}
}

func TestAccountSortClause(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"", "la.created_at DESC, la.id DESC", true},
		{"created", "la.created_at DESC, la.id DESC", true},
		{"balance", "la.balance_cents DESC, la.created_at DESC", true},
		{"synced", "la.last_synced_at DESC, la.created_at DESC", true},
		{"balance_cents", "", false},
		{"created_at; DROP TABLE members", "", false},
		{"la.balance_cents DESC", "", false},
	}
	for _, c := range cases {
		got, ok := accountSortClause(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("accountSortClause(%q) = (%q,%v), want (%q,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestAccountListWhere(t *testing.T) {
	mk := func(pairs ...string) map[string][]string {
		m := map[string][]string{}
		for i := 0; i < len(pairs); i += 2 {
			m[pairs[i]] = []string{pairs[i+1]}
		}
		return m
	}
	// Tanpa filter: hanya WHERE 1=1, tanpa argumen.
	if w, args, ok := accountListWhere(mk()); !ok || w != "WHERE 1=1" || len(args) != 0 {
		t.Errorf("tanpa filter = (%q,%v,%v), want WHERE 1=1 tanpa argumen", w, args, ok)
	}
	// Provider dinormalisasi ke huruf besar; status frozen memakai predikat beku.
	w, _, ok := accountListWhere(mk("provider", "dana", "status", "frozen"))
	if !ok || !strings.Contains(w, "la.provider=?") || !strings.Contains(w, frozenAccountExpr) {
		t.Errorf("provider dana + frozen = (%q,%v), want klausa provider + frozen", w, ok)
	}
	// Status active/pending mengecualikan yang beku.
	w, _, ok = accountListWhere(mk("status", "active"))
	if !ok || !strings.Contains(w, "la.status='active' AND NOT "+frozenAccountExpr) {
		t.Errorf("status active = (%q,%v), want active + NOT frozen", w, ok)
	}
	// Nilai tak dikenal ditolak.
	for _, bad := range []struct {
		k, v string
	}{
		{"provider", "OVO"}, {"status", "hapus"}, {"status", "active' OR '1'='1"},
	} {
		if _, _, ok := accountListWhere(mk(bad.k, bad.v)); ok {
			t.Errorf("accountListWhere(%s=%q) diterima, want ditolak", bad.k, bad.v)
		}
	}
	// Pencarian: LIKE di-escape (%, _, \ tidak jadi wildcard).
	w, args, ok := accountListWhere(mk("q", "100%_\\"))
	if !ok || len(args) != 4 {
		t.Fatalf("q = (%q,%v,%v), want 4 argumen LIKE", w, args, ok)
	}
	for _, a := range args {
		s, _ := a.(string)
		if !strings.Contains(s, `100\%\_\\`) {
			t.Errorf("argumen LIKE = %q, want wildcard ter-escape", s)
		}
	}
	// Predikat beku harus memuat definisi yang sama dengan FrozenAccountIDs:
	// kandidat active/pending, urutan created_at lalu id, batas max_accounts
	// paket aktif (COALESCE 0 bila tanpa paket aktif).
	for _, frag := range []string{
		"la.status IN ('active','pending')",
		"la2.created_at < la.created_at OR (la2.created_at = la.created_at AND la2.id < la.id)",
		"p.max_accounts", "sub.status = 'active'", "COALESCE(",
	} {
		if !strings.Contains(frozenAccountExpr, frag) {
			t.Errorf("frozenAccountExpr tidak memuat %q", frag)
		}
	}
}

// v41: ringkasan harus memuat frozen_count dari ekspresi beku yang SAMA
// dengan flag per baris — bila ekspresi berubah di satu tempat saja,
// angka kartu "Status Beku" dan pill Beku di daftar akan berbeda.
func TestAdminAccountsSummarySQLFrozen(t *testing.T) {
	sql := adminAccountsSummarySQL()
	if !strings.Contains(sql, frozenAccountExpr) {
		t.Fatal("summary SQL tidak memakai frozenAccountExpr — frozen_count akan berbeda definisi dari pill Beku")
	}
	if !strings.Contains(sql, "FROM linked_accounts la") {
		t.Fatal("summary SQL harus memakai alias la (dipakai frozenAccountExpr)")
	}
}

// v41: pemetaan error sync manual — sentinel → status/kode yang jujur.
func TestMapSyncAccountError(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{syncpkg.ErrSyncAccountNotFound, http.StatusNotFound, "not_found"},
		{syncpkg.ErrSyncAccountFrozen, http.StatusConflict, "account_frozen"},
		{syncpkg.ErrSyncAccountInactive, http.StatusConflict, "account_inactive"},
		{syncpkg.ErrSyncNoSubscription, http.StatusConflict, "subscription_inactive"},
		{syncpkg.ErrSyncNotBound, http.StatusConflict, "account_not_bound"},
		{syncpkg.ErrSyncBCAGuard, http.StatusConflict, "bca_sync_rejected"},
		{errors.New("connecta timeout"), http.StatusServiceUnavailable, "provider_error"},
	}
	for _, c := range cases {
		status, code, msg := mapSyncAccountError(c.err)
		if status != c.status || code != c.code || msg == "" {
			t.Errorf("mapSyncAccountError(%v) = (%d,%q,%q), want (%d,%q, non-empty)", c.err, status, code, msg, c.status, c.code)
		}
	}
	// Error sentinel yang di-wrap (%w) tetap terpetakan.
	wrapped := errors.Join(syncpkg.ErrSyncBCAGuard, errors.New("tambahan"))
	if _, code, _ := mapSyncAccountError(wrapped); code != "bca_sync_rejected" {
		t.Errorf("mapSyncAccountError(wrapped bca guard) = %q, want bca_sync_rejected", code)
	}
}

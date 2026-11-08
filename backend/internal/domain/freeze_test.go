package domain

import (
	"testing"
	"time"
)

func TestFrozenAccountIDsKeepsEarliest(t *testing.T) {
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	cands := []FreezeCandidate{
		{ID: "c3", CreatedAt: base.Add(3 * time.Hour)},
		{ID: "c1", CreatedAt: base.Add(1 * time.Hour)},
		{ID: "c2", CreatedAt: base.Add(2 * time.Hour)},
		{ID: "c4", CreatedAt: base.Add(4 * time.Hour)},
	}
	frozen := FrozenAccountIDs(cands, 2)
	if len(frozen) != 2 || !frozen["c3"] || !frozen["c4"] {
		t.Fatalf("frozen = %v, want {c3 c4}", frozen)
	}
	if frozen["c1"] || frozen["c2"] {
		t.Fatalf("rekening awal ikut beku: %v", frozen)
	}
}

func TestFrozenAccountIDsZeroFreezesAll(t *testing.T) {
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	cands := []FreezeCandidate{
		{ID: "a", CreatedAt: base},
		{ID: "b", CreatedAt: base.Add(time.Hour)},
	}
	for _, n := range []int{0, -1, -5} {
		frozen := FrozenAccountIDs(cands, n)
		if len(frozen) != 2 || !frozen["a"] || !frozen["b"] {
			t.Fatalf("N=%d: frozen = %v, want semua beku", n, frozen)
		}
	}
}

func TestFrozenAccountIDsLargeNFreezesNone(t *testing.T) {
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	cands := []FreezeCandidate{
		{ID: "a", CreatedAt: base},
		{ID: "b", CreatedAt: base.Add(time.Hour)},
	}
	for _, n := range []int{2, 3, 100} {
		if frozen := FrozenAccountIDs(cands, n); len(frozen) != 0 {
			t.Fatalf("N=%d: frozen = %v, want kosong", n, frozen)
		}
	}
	// Daftar kosong tidak pernah beku.
	if frozen := FrozenAccountIDs(nil, 0); len(frozen) != 0 {
		t.Fatalf("daftar kosong: frozen = %v, want kosong", frozen)
	}
}

func TestFrozenAccountIDsTiebreakByID(t *testing.T) {
	same := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	cands := []FreezeCandidate{
		{ID: "z", CreatedAt: same},
		{ID: "a", CreatedAt: same},
		{ID: "m", CreatedAt: same},
	}
	// created_at sama semua: urutan ID ASC — "a" dipertahankan, "m"+"z" beku.
	frozen := FrozenAccountIDs(cands, 1)
	if len(frozen) != 2 || !frozen["m"] || !frozen["z"] || frozen["a"] {
		t.Fatalf("frozen = %v, want {m z}", frozen)
	}
	// Deterministik: ulangi dengan urutan input berbeda, hasil sama.
	cands2 := []FreezeCandidate{
		{ID: "m", CreatedAt: same},
		{ID: "z", CreatedAt: same},
		{ID: "a", CreatedAt: same},
	}
	frozen2 := FrozenAccountIDs(cands2, 1)
	if len(frozen2) != 2 || !frozen2["m"] || !frozen2["z"] {
		t.Fatalf("frozen2 = %v, want {m z}", frozen2)
	}
}

func TestFrozenCandidatesOrder(t *testing.T) {
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	cands := []FreezeCandidate{
		{ID: "c4", CreatedAt: base.Add(4 * time.Hour)},
		{ID: "c2", CreatedAt: base.Add(2 * time.Hour)},
		{ID: "c3", CreatedAt: base.Add(3 * time.Hour)},
	}
	got := FrozenCandidates(cands, 1)
	if len(got) != 2 || got[0].ID != "c3" || got[1].ID != "c4" {
		t.Fatalf("would_freeze = %v, want [c3 c4] urut created_at ASC", got)
	}
	if got := FrozenCandidates(cands, 5); got != nil {
		t.Fatalf("N>=jumlah: got %v, want nil", got)
	}
}

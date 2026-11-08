// Package domain — freeze.go: aturan pembekuan sync rekening saat
// member pindah ke paket dengan max_accounts lebih kecil.
//
// Semantik (v30, dipakai identik oleh HTTP layer — handleListAccounts —
// dan sync worker — PollOnce): dari semua rekening terhubung member
// (status active/pending), N = max_accounts paket aktif yang paling
// dulu dihubungkan dipertahankan; sisanya dibekukan (sync dijeda, data
// lama tetap tampil). Urutan stabil: created_at ASC, tiebreak ID ASC.
package domain

import (
	"sort"
	"time"
)

// FreezeCandidate adalah satu rekening terhubung yang dipertimbangkan
// untuk dibekukan.
type FreezeCandidate struct {
	ID        string
	CreatedAt time.Time
}

// FrozenAccountIDs mengembalikan himpunan ID rekening yang beku.
// N pertama (created_at ASC, tiebreak ID ASC) dipertahankan.
// N <= 0 membekukan semua; N >= jumlah kandidat membekukan nol.
func FrozenAccountIDs(candidates []FreezeCandidate, maxAccounts int) map[string]bool {
	frozen := map[string]bool{}
	if len(candidates) == 0 {
		return frozen
	}
	if maxAccounts <= 0 {
		for _, c := range candidates {
			frozen[c.ID] = true
		}
		return frozen
	}
	if maxAccounts >= len(candidates) {
		return frozen
	}
	sorted := make([]FreezeCandidate, len(candidates))
	copy(sorted, candidates)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return sorted[i].ID < sorted[j].ID
	})
	for _, c := range sorted[maxAccounts:] {
		frozen[c.ID] = true
	}
	return frozen
}

// FrozenCandidates mengembalikan kandidat yang beku, urut created_at
// ASC (tiebreak ID ASC) — dipakai untuk daftar would_freeze di
// respons 409 ganti paket.
func FrozenCandidates(candidates []FreezeCandidate, maxAccounts int) []FreezeCandidate {
	frozen := FrozenAccountIDs(candidates, maxAccounts)
	if len(frozen) == 0 {
		return nil
	}
	sorted := make([]FreezeCandidate, len(candidates))
	copy(sorted, candidates)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return sorted[i].ID < sorted[j].ID
	})
	out := []FreezeCandidate{}
	for _, c := range sorted {
		if frozen[c.ID] {
			out = append(out, c)
		}
	}
	return out
}

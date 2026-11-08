package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- v30: ganti paket (confirm_replace / cancel-old) ---
//
// Tes ber-DB tidak dimungkinkan oleh pola repo ini: tidak ada sqlmock
// dan tidak ada harness MySQL (semua tes internal/http murni). Yang
// diuji di sini adalah bagian deterministiknya — payload 409,
// remaining_days, dan detail audit — sementara SQL cancel-old
// (UPDATE ... status='cancelled' ... id<>?) diverifikasi lewat
// go vet + review query di activateSubscriptionTx /
// cancelOldSubscriptionsTx.

func TestRemainingDaysUntil(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		expires time.Time
		want    int
	}{
		{"tepat 10 hari", now.Add(10 * 24 * time.Hour), 10},
		{"10 hari 1 jam dibulatkan ke atas", now.Add(10*24*time.Hour + time.Hour), 11},
		{"setengah hari", now.Add(12 * time.Hour), 1},
		{"sudah lewat", now.Add(-time.Hour), 0},
		{"tepat sekarang", now, 0},
	}
	for _, tc := range cases {
		if got := remainingDaysUntil(tc.expires, now); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestReplaceConflictPayload(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	expires := now.Add(10*24*time.Hour + 2*time.Hour) // 11 hari (ceil)
	c := &replaceConflict{
		OldPlanName: "Starter", OldExpiresAt: expires,
		NewPlanName: "Pro", NewMaxAccounts: 2, NewPriceCents: 90000000,
		ConnectedCount: 3,
		WouldFreeze: []replaceFreezeItem{
			{ID: "acc3", Provider: "DANA", Masked: "0812****3456", CreatedAt: now.Add(-24 * time.Hour)},
		},
	}
	body := c.payload(now)
	if body["error"] != "active_subscription_exists" {
		t.Fatalf("error = %v, want active_subscription_exists", body["error"])
	}
	oldPlan, ok := body["old_plan"].(map[string]any)
	if !ok {
		t.Fatalf("old_plan bukan map: %v", body["old_plan"])
	}
	if oldPlan["name"] != "Starter" {
		t.Fatalf("old_plan.name = %v", oldPlan["name"])
	}
	if oldPlan["expires_at"] != formatWIB(expires) {
		t.Fatalf("old_plan.expires_at = %v, want %v", oldPlan["expires_at"], formatWIB(expires))
	}
	if oldPlan["remaining_days"] != 11 {
		t.Fatalf("old_plan.remaining_days = %v, want 11", oldPlan["remaining_days"])
	}
	newPlan, ok := body["new_plan"].(map[string]any)
	if !ok {
		t.Fatalf("new_plan bukan map: %v", body["new_plan"])
	}
	if newPlan["name"] != "Pro" || newPlan["max_accounts"] != 2 || newPlan["price_cents"] != int64(90000000) {
		t.Fatalf("new_plan = %v", newPlan)
	}
	if body["connected_count"] != 3 {
		t.Fatalf("connected_count = %v, want 3", body["connected_count"])
	}
	freeze, ok := body["would_freeze"].([]map[string]any)
	if !ok || len(freeze) != 1 {
		t.Fatalf("would_freeze = %v, want 1 item", body["would_freeze"])
	}
	if freeze[0]["id"] != "acc3" || freeze[0]["provider"] != "DANA" ||
		freeze[0]["masked"] != "0812****3456" ||
		freeze[0]["created_at"] != formatWIB(now.Add(-24*time.Hour)) {
		t.Fatalf("would_freeze[0] = %v", freeze[0])
	}
	// Tanpa rekening beku: would_freeze tetap array kosong, bukan null.
	empty := (&replaceConflict{OldPlanName: "Starter", OldExpiresAt: expires,
		NewPlanName: "Pro", NewMaxAccounts: 5, NewPriceCents: 1,
		ConnectedCount: 1, WouldFreeze: []replaceFreezeItem{}}).payload(now)
	raw, _ := json.Marshal(empty)
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if wf, ok := decoded["would_freeze"].([]any); !ok || len(wf) != 0 {
		t.Fatalf("would_freeze kosong = %v, want []", decoded["would_freeze"])
	}
}

func TestWriteReplaceConflictStatus(t *testing.T) {
	now := time.Now()
	c := &replaceConflict{
		OldPlanName: "Starter", OldExpiresAt: now.Add(24 * time.Hour),
		NewPlanName: "Pro", NewMaxAccounts: 2, NewPriceCents: 90000000,
		ConnectedCount: 0, WouldFreeze: []replaceFreezeItem{},
	}
	rec := httptest.NewRecorder()
	writeReplaceConflict(rec, c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "active_subscription_exists" {
		t.Fatalf("error = %v", body["error"])
	}
}

func TestSubscriptionReplacedDetail(t *testing.T) {
	got := subscriptionReplacedDetail([]string{"Starter"}, "Pro")
	if got != "paket: 'Starter' -> 'Pro'" {
		t.Fatalf("detail = %q", got)
	}
	got = subscriptionReplacedDetail([]string{"Starter", "Trial"}, "Pro")
	if got != "paket: 'Starter', 'Trial' -> 'Pro'" {
		t.Fatalf("detail multi = %q", got)
	}
}

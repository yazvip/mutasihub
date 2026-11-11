package http

import (
	"testing"
	"time"
)

func TestNotifyShouldSend(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name        string
		newCount    int64
		last        time.Time
		hasLast     bool
		intervalMin int
		sentToday   int
		want        bool
	}{
		{"tanpa mutasi baru = tanpa kirim", 0, time.Time{}, false, 3, 0, false},
		{"mutasi baru + belum pernah kirim = kirim", 2, time.Time{}, false, 3, 0, true},
		{"mutasi baru + interval belum lewat = tahan", 2, now.Add(-1 * time.Minute), true, 3, 0, false},
		{"mutasi baru + interval pas lewat = kirim", 2, now.Add(-3 * time.Minute), true, 3, 0, true},
		{"mutasi baru + interval lewat + cap tercapai = tahan", 2, now.Add(-10 * time.Minute), true, 3, 200, false},
		{"mutasi baru + interval lewat + di bawah cap = kirim", 2, now.Add(-10 * time.Minute), true, 3, 199, true},
		{"interval 0 diklem ke 1 menit", 1, now.Add(-30 * time.Second), true, 0, 0, false},
	}
	for _, tc := range cases {
		if got := notifyShouldSend(tc.newCount, tc.last, tc.hasLast, tc.intervalMin, tc.sentToday, mutationNotifyCapPerDay, now); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNotifyAdvanceWatermark(t *testing.T) {
	if got := notifyAdvanceWatermark(true, 42, 10); got != 42 {
		t.Errorf("sukses harus maju ke maxID: got %d, want 42", got)
	}
	if got := notifyAdvanceWatermark(false, 42, 10); got != 10 {
		t.Errorf("gagal harus tetap di watermark lama: got %d, want 10", got)
	}
}

package http

import (
	"testing"
	"time"
)

// v42a: throttle tes callback — maks 1 tes/menit/member.
func TestCallbackTestThrottled(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		last time.Time
		want bool
	}{
		{"30 detik lalu: masih throttle", now.Add(-30 * time.Second), true},
		{"59 detik lalu: masih throttle", now.Add(-59 * time.Second), true},
		{"61 detik lalu: boleh lagi", now.Add(-61 * time.Second), false},
		{"2 menit lalu: boleh lagi", now.Add(-2 * time.Minute), false},
	}
	for _, tc := range cases {
		if got := callbackTestThrottled(tc.last, now); got != tc.want {
			t.Errorf("%s: callbackTestThrottled = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// v42a: paginasi riwayat callback — default 1/20, page_size maks 50.
func TestParseDeliveriesPage(t *testing.T) {
	cases := []struct {
		page, size string
		wantPage   int
		wantSize   int
	}{
		{"", "", 1, 20},
		{"2", "10", 2, 10},
		{"0", "0", 1, 20},
		{"3", "100", 3, 50},
		{"abc", "xyz", 1, 20},
		{"-1", "-5", 1, 20},
		{"1", "50", 1, 50},
		{"1", "51", 1, 50},
	}
	for _, tc := range cases {
		gotPage, gotSize := parseDeliveriesPage(tc.page, tc.size)
		if gotPage != tc.wantPage || gotSize != tc.wantSize {
			t.Errorf("parseDeliveriesPage(%q,%q) = %d/%d, want %d/%d",
				tc.page, tc.size, gotPage, gotSize, tc.wantPage, tc.wantSize)
		}
	}
}

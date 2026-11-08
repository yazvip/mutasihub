package http

import (
	"testing"
	"time"
)

// Regresi P1-6: tanggal API harus berzona +07:00 dengan wall-clock WIB
// yang benar, bukan +08:00 / "Z" ber-wall-clock CST.
func TestFormatWIB(t *testing.T) {
	// Instant 19:11:18 CST (dibaca dari kolom TIMESTAMP dengan
	// loc=Asia/Shanghai) = 18:11:18 WIB.
	cst := time.FixedZone("CST", 8*3600)
	in := time.Date(2026, 11, 7, 19, 11, 18, 0, cst)
	if got := formatWIB(in); got != "2026-11-07T18:11:18+07:00" {
		t.Fatalf("formatWIB(%v) = %q, want 2026-11-07T18:11:18+07:00", in, got)
	}
}

func TestFormatWIBWallClock(t *testing.T) {
	// tx_date DATETIME menyimpan wall-clock WIB 10:15:00; dibaca driver
	// sebagai 10:15 +08:00 — jamnya TIDAK BOLEH bergeser.
	cst := time.FixedZone("CST", 8*3600)
	in := time.Date(2026, 11, 7, 10, 15, 0, 0, cst)
	if got := formatWIBWallClock(in); got != "2026-11-07T10:15:00+07:00" {
		t.Fatalf("formatWIBWallClock(%v) = %q, want 2026-11-07T10:15:00+07:00", in, got)
	}
}

func TestFormatWIBString(t *testing.T) {
	// String mentah kolom TIMESTAMP "2026-11-07 19:11:18" adalah
	// wall-clock CST → 18:11:18 WIB.
	if got := formatWIBString("2026-11-07 19:11:18"); got != "2026-11-07T18:11:18+07:00" {
		t.Fatalf("formatWIBString = %q, want 2026-11-07T18:11:18+07:00", got)
	}
	if got := formatWIBString(""); got != "" {
		t.Fatalf("formatWIBString(\"\") = %q, want empty", got)
	}
	if got := formatWIBString("bukan-tanggal"); got != "bukan-tanggal" {
		t.Fatalf("formatWIBString tak ter-parse = %q, want input apa adanya", got)
	}
}

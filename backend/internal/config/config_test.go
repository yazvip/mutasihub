package config

import (
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

// TestWithMySQLLocParseable memastikan DSN hasil withMySQLLoc bisa
// di-parse go-sql-driver. Regresi v21: "loc=Asia/Shanghai" mentah
// (garis miring tak ter-escape) ditolak driver dengan
// "invalid DSN: did you forget to escape a param value?", backend jalan
// mode no-DB dan healthz db:false. Nilai loc WAJIB ter-escape
// (Asia%2FShanghai).
func TestWithMySQLLocParseable(t *testing.T) {
	// Bentuk sama seperti DSN live (password dummy tanpa karakter spesial).
	const sample = "user:dummy-pass-123@tcp(127.0.0.1:3306)/mutasi_hub?parseTime=true&multiStatements=true"
	got := withMySQLLoc(sample)
	if !strings.Contains(got, "loc=Asia%2FShanghai") {
		t.Fatalf("withMySQLLoc(%q) = %q, want loc=Asia%%2FShanghai", sample, got)
	}
	cfg, err := mysql.ParseDSN(got)
	if err != nil {
		t.Fatalf("mysql.ParseDSN(%q) error: %v", got, err)
	}
	if cfg.Loc.String() != "Asia/Shanghai" {
		t.Fatalf("ParseDSN loc = %q, want Asia/Shanghai", cfg.Loc.String())
	}
	if !cfg.ParseTime || !cfg.MultiStatements {
		t.Fatalf("ParseDSN kehilangan param lain: parseTime=%v multiStatements=%v", cfg.ParseTime, cfg.MultiStatements)
	}
}

func TestWithMySQLLocIdempotent(t *testing.T) {
	const withLoc = "user:pass@tcp(127.0.0.1:3306)/db?parseTime=true&loc=Asia%2FShanghai"
	if got := withMySQLLoc(withLoc); got != withLoc {
		t.Fatalf("withMySQLLoc dengan loc yang sudah ada mengubah DSN: %q", got)
	}
	if got := withMySQLLoc(""); got != "" {
		t.Fatalf("withMySQLLoc(\"\") = %q, want empty", got)
	}
	const noQuery = "user:pass@tcp(127.0.0.1:3306)/db"
	got := withMySQLLoc(noQuery)
	if !strings.HasPrefix(got, noQuery+"?loc=Asia%2FShanghai") {
		t.Fatalf("withMySQLLoc(%q) = %q, want ?loc=...", noQuery, got)
	}
	if _, err := mysql.ParseDSN(got); err != nil {
		t.Fatalf("mysql.ParseDSN(%q) error: %v", got, err)
	}
}

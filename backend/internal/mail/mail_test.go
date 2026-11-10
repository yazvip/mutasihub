package mail

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeStore struct{ vals map[string]string }

func (f fakeStore) GetSetting(_ context.Context, k string) (string, error) {
	return f.vals[k], nil
}

func TestLoadFromSettingsDisabled(t *testing.T) {
	_, err := LoadFromSettings(context.Background(), fakeStore{map[string]string{}}, nil, nil)
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("tanpa smtp_enabled=1 harus ErrNotConfigured, dapat %v", err)
	}
}

func TestLoadFromSettingsOK(t *testing.T) {
	st := fakeStore{map[string]string{
		KeyEnabled: "1", KeyHost: "smtp.example.id", KeyPort: "465",
		KeyTLSMode: "tls", KeyFromEmail: "noreply@example.id", KeyFromName: "MutasiHub",
		KeyUsername: "user", KeyPassword: "enc:xxx",
	}}
	cfg, err := LoadFromSettings(context.Background(), st, []byte("k"),
		func(_ []byte, s string) (string, error) {
			if s != "xxx" {
				t.Fatalf("decrypt menerima %q", s)
			}
			return "rahasia", nil
		})
	if err != nil {
		t.Fatalf("LoadFromSettings: %v", err)
	}
	if cfg.Port != 465 || cfg.TLSMode != "tls" || cfg.Password != "rahasia" {
		t.Fatalf("config salah: %+v", cfg)
	}
}

func TestLoadFromSettingsBadPort(t *testing.T) {
	st := fakeStore{map[string]string{
		KeyEnabled: "1", KeyHost: "smtp.example.id", KeyPort: "abc",
		KeyFromEmail: "noreply@example.id",
	}}
	if _, err := LoadFromSettings(context.Background(), st, nil, nil); err == nil {
		t.Fatal("port bukan angka harus ditolak")
	}
}

func TestBuildMessageIndonesianSubject(t *testing.T) {
	cfg := &Config{FromName: "MutasiHub", FromEmail: "noreply@example.id"}
	msg := string(buildMessage(cfg, "a@b.id", "Tagihan paket Pro — menunggu pembayaran", "teks", "<p>html</p>"))
	if !strings.Contains(msg, "multipart/alternative") {
		t.Fatal("harus multipart/alternative")
	}
	if strings.Contains(msg, "— menunggu") {
		t.Fatal("subjek non-ASCII harus ter-encode, bukan mentah")
	}
	if !strings.Contains(msg, "Content-Type: text/plain") || !strings.Contains(msg, "Content-Type: text/html") {
		t.Fatal("harus ada bagian teks dan HTML")
	}
}

func TestSendNotConfigured(t *testing.T) {
	if err := Send(nil, "a@b.id", "x", "t", "h"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("cfg nil harus ErrNotConfigured, dapat %v", err)
	}
	if err := Send(&Config{}, "bukan-email", "x", "t", "h"); err == nil {
		t.Fatal("alamat tujuan tidak valid harus ditolak")
	}
}

package mail

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

// --- v38: provider Mailketing API ---

func mailketingStore(vals map[string]string) fakeStore {
	if vals == nil {
		vals = map[string]string{}
	}
	vals[KeyFromName] = "MutasiHub"
	vals[KeyFromEmail] = "official@rajacek.com"
	return fakeStore{vals}
}

func fakeDecrypt(t *testing.T, want string) DecryptFunc {
	return func(_ []byte, s string) (string, error) {
		if s != want {
			t.Fatalf("decrypt menerima %q, mau %q", s, want)
		}
		return "TOKEN-ASLI", nil
	}
}

func TestLoadSenderDefaultSMTP(t *testing.T) {
	st := mailketingStore(map[string]string{
		KeyEnabled: "1", KeyHost: "smtp.example.id", KeyFromEmail: "official@rajacek.com",
	})
	if _, err := LoadSender(context.Background(), st, nil, nil); err != nil {
		t.Fatalf("tanpa mail_provider harus default SMTP, dapat %v", err)
	}
}

func TestLoadSenderUnknownProvider(t *testing.T) {
	st := mailketingStore(map[string]string{KeyProvider: "bogus"})
	if _, err := LoadSender(context.Background(), st, nil, nil); err == nil {
		t.Fatal("provider tidak dikenal harus ditolak")
	}
}

func TestLoadSenderMailketingNoKey(t *testing.T) {
	st := mailketingStore(map[string]string{KeyProvider: ProviderMailketingAPI})
	_, err := LoadSender(context.Background(), st, nil, nil)
	if !errors.Is(err, ErrAPIKeyNotConfigured) {
		t.Fatalf("tanpa API key harus ErrAPIKeyNotConfigured, dapat %v", err)
	}
}

func TestLoadSenderMailketingNoFrom(t *testing.T) {
	st := fakeStore{map[string]string{
		KeyProvider: ProviderMailketingAPI, KeyMailketingAPIKey: "enc:xxx",
		KeyFromName: "MutasiHub", KeyFromEmail: "",
	}}
	_, err := LoadSender(context.Background(), st, []byte("k"), fakeDecrypt(t, "xxx"))
	if !errors.Is(err, ErrAPIKeyNotConfigured) {
		t.Fatalf("tanpa alamat pengirim harus ErrAPIKeyNotConfigured, dapat %v", err)
	}
}

func TestSendViaAPI(t *testing.T) {
	var gotAuth, gotCT string
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		if r.URL.Path != "/api/v2/send" || r.Method != http.MethodPost {
			t.Errorf("request salah: %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"message_id":"<api.1@rajacek.com>"},"message":"Email queued successfully"}`))
	}))
	defer srv.Close()

	cfg := &APIConfig{Token: "TOKEN-ASLI", FromName: "MutasiHub", FromEmail: "official@rajacek.com", Endpoint: srv.URL + "/api/v2/send"}
	if err := SendViaAPI(context.Background(), cfg, "member@example.id", "Judul tes", "teks biasa", "<html><body><p>html</p></body></html>"); err != nil {
		t.Fatalf("SendViaAPI: %v", err)
	}
	if gotAuth != "Bearer TOKEN-ASLI" {
		t.Fatalf("Authorization salah: %q", gotAuth)
	}
	if gotCT != "application/json" {
		t.Fatalf("Content-Type salah: %q", gotCT)
	}
	if gotBody["from_email"] != "official@rajacek.com" || gotBody["recipient"] != "member@example.id" ||
		gotBody["subject"] != "Judul tes" || gotBody["from_name"] != "MutasiHub" {
		t.Fatalf("body salah: %+v", gotBody)
	}
	if !strings.Contains(gotBody["content"], "<html>") {
		t.Fatal("content harus HTML (mengandung <html>)")
	}
	if _, ok := gotBody["api_token"]; ok {
		t.Fatal("token tidak boleh dikirim di body")
	}
}

func TestSendViaAPIErrors(t *testing.T) {
	cases := []struct {
		status int
		body   string
		ra     string
		want   string
	}{
		{401, `{"success":false,"message":"Invalid API token"}`, "", "token API tidak valid"},
		{402, `{"success":false,"message":"Insufficient credits"}`, "", "kredit habis"},
		{403, `{"success":false,"message":"Unknown sender domain. Please add your sender email in Add Domain menu."}`, "", "domain pengirim belum terverifikasi"},
		{422, `{"success":false,"message":"Validation failed","errors":{"recipient":"Recipient must be a valid email"}}`, "", "validasi gagal"},
		{429, `{"success":false,"message":"Rate limit exceeded"}`, "30", "30 detik"},
		{500, `{"success":false,"message":"Server sibuk"}`, "", "HTTP 500"},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c.ra != "" {
				w.Header().Set("Retry-After", c.ra)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(c.status)
			_, _ = w.Write([]byte(c.body))
		}))
		cfg := &APIConfig{Token: "TOKEN-ASLI", FromName: "MutasiHub", FromEmail: "official@rajacek.com", Endpoint: srv.URL}
		err := SendViaAPI(context.Background(), cfg, "a@b.id", "x", "t", "<html><body>x</body></html>")
		srv.Close()
		if err == nil {
			t.Fatalf("HTTP %d harus error", c.status)
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Fatalf("HTTP %d: error %q harus mengandung %q", c.status, err.Error(), c.want)
		}
		if strings.Contains(err.Error(), "TOKEN-ASLI") {
			t.Fatalf("HTTP %d: error tidak boleh mengandung token: %q", c.status, err.Error())
		}
	}
}

func TestSendViaAPINoToken(t *testing.T) {
	if err := SendViaAPI(context.Background(), &APIConfig{}, "a@b.id", "x", "t", "h"); !errors.Is(err, ErrAPIKeyNotConfigured) {
		t.Fatalf("tanpa token harus ErrAPIKeyNotConfigured, dapat %v", err)
	}
}

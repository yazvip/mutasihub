// Provider Mailketing API (v38): pengiriman email lewat REST API
// Mailketing (POST /api/v2/send) sebagai alternatif SMTP.
//
// Dokumentasi yang dipakai (dibaca 10 Nov 2026, jangan mengarang):
//   - https://mailketing.co.id/docs/send-email-via-api/ (POST /send)
//   - https://api.mailketing.co.id/docs/ (API v2)
// Endpoint: POST https://api.mailketing.co.id/api/v2/send
// Auth: Authorization: Bearer <API token> (token dari dashboard
// Mailketing → Integrasi → Email Application API).
// Body JSON: from_name, from_email, subject, recipient, content
// (satu request = satu penerima; content dianggap HTML hanya bila
// mengandung tag <html> — emailShell kita selalu menghasilkannya).
// Sukses: HTTP 200 {success:true, data:{message_id}, message}.
// Error: 401 token tidak valid, 402 kredit habis, 403 domain pengirim
// belum terverifikasi, 422 validasi gagal (field errors), 429 rate
// limit (hanya request gagal yang dibatasi: maks 30/menit/IP).
//
// Token tersimpan "enc:" + AES-256-GCM di tabel settings (sama seperti
// password SMTP) dan TIDAK PERNAH muncul di error atau log.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
)

// Provider pengiriman email (settings key mail_provider).
const (
	ProviderSMTP          = "smtp"
	ProviderMailketingAPI = "mailketing_api"
)

const (
	// KeyProvider memilih provider aktif ("smtp" | "mailketing_api").
	KeyProvider = "mail_provider"
	// KeyMailketingAPIKey menyimpan token API Mailketing ("enc:" + ciphertext).
	KeyMailketingAPIKey = "mailketing_api_key"
)

// MailketingSendURL adalah endpoint API v2 Mailketing (POST /send).
const MailketingSendURL = "https://api.mailketing.co.id/api/v2/send"

// ErrAPIKeyNotConfigured: provider mailketing_api aktif tapi API key
// belum diisi (atau alamat pengirim belum diatur). Callers
// menerjemahkannya ke 400 mailketing_api_key_not_configured.
var ErrAPIKeyNotConfigured = errors.New("mail: API key Mailketing belum dikonfigurasi")

// Sender mengirim satu email lewat provider yang aktif.
type Sender interface {
	Send(ctx context.Context, to, subject, textBody, htmlBody string) error
}

// smtpSender membungkus Config SMTP agar memenuhi Sender.
type smtpSender struct{ cfg *Config }

func (s smtpSender) Send(_ context.Context, to, subject, textBody, htmlBody string) error {
	return Send(s.cfg, to, subject, textBody, htmlBody)
}

// APIConfig adalah satu akun Mailketing API.
type APIConfig struct {
	Token     string
	FromName  string
	FromEmail string
	// Endpoint terisi default MailketingSendURL; bisa diubah untuk tes.
	Endpoint string
	// HTTPClient terisi default (timeout 15 dtk) bila nil.
	HTTPClient *http.Client
}

// LoadAPIConfig memuat konfigurasi Mailketing API dari tabel settings.
// Nama + alamat pengirim dipakai ulang dari field smtp_from_name /
// smtp_from_email yang sudah ada (satu identitas pengirim untuk semua
// provider).
func LoadAPIConfig(ctx context.Context, store Store, encKey []byte, decrypt DecryptFunc) (*APIConfig, error) {
	get := func(k string) string {
		v, err := store.GetSetting(ctx, k)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	enc := get(KeyMailketingAPIKey)
	if enc == "" {
		return nil, ErrAPIKeyNotConfigured
	}
	if !strings.HasPrefix(enc, "enc:") {
		return nil, errors.New("mail: API key Mailketing tersimpan dalam format yang tidak dikenal")
	}
	if len(encKey) == 0 || decrypt == nil {
		return nil, errors.New("mail: kunci enkripsi tidak tersedia untuk membaca API key Mailketing")
	}
	token, err := decrypt(encKey, strings.TrimPrefix(enc, "enc:"))
	if err != nil {
		return nil, fmt.Errorf("mail: dekripsi API key Mailketing gagal: %w", err)
	}
	cfg := &APIConfig{Token: token, FromName: get(KeyFromName), FromEmail: get(KeyFromEmail), Endpoint: MailketingSendURL}
	if cfg.FromEmail == "" || !strings.Contains(cfg.FromEmail, "@") {
		return nil, ErrAPIKeyNotConfigured
	}
	return cfg, nil
}

// LoadSender memilih provider dari settings dan mengembalikan Sender
// yang siap dipakai. Bila kunci mail_provider belum ada, defaultnya
// "smtp" (kompatibel dengan instalasi v37).
func LoadSender(ctx context.Context, store Store, encKey []byte, decrypt DecryptFunc) (Sender, error) {
	provider, err := store.GetSetting(ctx, KeyProvider)
	if err != nil {
		provider = ""
	}
	switch strings.TrimSpace(provider) {
	case "", ProviderSMTP:
		cfg, err := LoadFromSettings(ctx, store, encKey, decrypt)
		if err != nil {
			return nil, err
		}
		return smtpSender{cfg: cfg}, nil
	case ProviderMailketingAPI:
		cfg, err := LoadAPIConfig(ctx, store, encKey, decrypt)
		if err != nil {
			return nil, err
		}
		return apiSender{cfg: cfg}, nil
	default:
		return nil, fmt.Errorf("mail: provider email tidak dikenal: %q", provider)
	}
}

// apiSender membungkus APIConfig agar memenuhi Sender.
type apiSender struct{ cfg *APIConfig }

func (s apiSender) Send(ctx context.Context, to, subject, textBody, htmlBody string) error {
	return SendViaAPI(ctx, s.cfg, to, subject, textBody, htmlBody)
}

// SendViaAPI mengirim satu email lewat POST /api/v2/send Mailketing.
// Token TIDAK PERNAH muncul di error atau log.
func SendViaAPI(ctx context.Context, cfg *APIConfig, to, subject, textBody, htmlBody string) error {
	if cfg == nil || cfg.Token == "" {
		return ErrAPIKeyNotConfigured
	}
	if _, err := mail.ParseAddress(to); err != nil {
		return fmt.Errorf("mail: alamat tujuan tidak valid: %w", err)
	}
	if strings.TrimSpace(subject) == "" {
		return errors.New("mail: subjek kosong")
	}
	content := strings.TrimSpace(htmlBody)
	if content == "" {
		content = strings.TrimSpace(textBody)
	}
	payload, err := json.Marshal(map[string]string{
		"from_name": cfg.FromName,
		"from_email": cfg.FromEmail,
		"subject":   subject,
		"recipient": to,
		"content":   content,
	})
	if err != nil {
		return fmt.Errorf("mailketing: susun request gagal: %w", err)
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = MailketingSendURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("mailketing: buat request gagal: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("mailketing: request ke API gagal: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	var parsed struct {
		Success bool              `json:"success"`
		Message string            `json:"message"`
		Errors  map[string]string `json:"errors"`
	}
	_ = json.Unmarshal(raw, &parsed)
	if resp.StatusCode == http.StatusOK && parsed.Success {
		return nil
	}
	return mapAPIError(resp.StatusCode, parsed.Message, parsed.Errors, resp.Header)
}

// mapAPIError menerjemahkan respons gagal API v2 menjadi error yang
// bisa dibaca admin (tanpa token, tanpa body mentah).
func mapAPIError(status int, msg string, errs map[string]string, header http.Header) error {
	detail := strings.TrimSpace(msg)
	if detail == "" {
		detail = http.StatusText(status)
	}
	switch status {
	case http.StatusUnauthorized:
		return errors.New("mailketing: token API tidak valid")
	case http.StatusPaymentRequired:
		return errors.New("mailketing: kredit habis — isi kredit dulu")
	case http.StatusForbidden:
		return errors.New("mailketing: domain pengirim belum terverifikasi di Mailketing")
	case http.StatusUnprocessableEntity:
		if len(errs) > 0 {
			var parts []string
			for k, v := range errs {
				parts = append(parts, k+": "+v)
			}
			return fmt.Errorf("mailketing: validasi gagal: %s", strings.Join(parts, "; "))
		}
		return fmt.Errorf("mailketing: validasi gagal: %s", detail)
	case http.StatusTooManyRequests:
		if ra := strings.TrimSpace(header.Get("Retry-After")); ra != "" {
			if n, err := strconv.Atoi(ra); err == nil {
				return fmt.Errorf("mailketing: batas kirim terlampaui, coba lagi dalam %d detik", n)
			}
		}
		return errors.New("mailketing: batas kirim terlampaui, coba lagi nanti")
	default:
		return fmt.Errorf("mailketing: gagal mengirim (HTTP %d): %s", status, detail)
	}
}

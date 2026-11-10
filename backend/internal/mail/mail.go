// Package mail sends email through a user-configured SMTP server.
//
// Stdlib only (net/smtp + crypto/tls): no new dependencies. Supports
// STARTTLS (port 587), implicit TLS (port 465) and plain SMTP (no TLS,
// for a local relay only). The SMTP password is stored encrypted
// (AES-256-GCM, prefix "enc:") in the settings table — never plaintext
// — and is never returned to any client.
package mail

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// ErrNotConfigured reports that SMTP is disabled or incompletely
// configured. Callers translate it to a clean 400 smtp_not_configured,
// never to a made-up success.
var ErrNotConfigured = errors.New("mail: SMTP belum dikonfigurasi")

// Config is one SMTP account, as configured by the admin.
type Config struct {
	Enabled  bool
	Host     string
	Port     int
	Username string
	Password string
	// TLSMode is one of "none", "starttls" or "tls".
	TLSMode   string
	FromName  string
	FromEmail string
}

// Setting keys (settings table). The password value is stored as
// "enc:" + base64(AES-256-GCM ciphertext).
const (
	KeyEnabled   = "smtp_enabled"
	KeyHost      = "smtp_host"
	KeyPort      = "smtp_port"
	KeyUsername  = "smtp_username"
	KeyPassword  = "smtp_password"
	KeyTLSMode   = "smtp_tls_mode"
	KeyFromName  = "smtp_from_name"
	KeyFromEmail = "smtp_from_email"
)

// Store is the subset of db.Store that mail needs (settings reads).
type Store interface {
	GetSetting(ctx context.Context, key string) (string, error)
}

// DecryptFunc decrypts an "enc:" password value. It is crypto.Decrypt
// in production; injectable so tests do not need a real key.
type DecryptFunc func(key []byte, encoded string) (string, error)

// LoadFromSettings builds a Config from the settings table. When SMTP
// is disabled or the host/from address is missing it returns
// ErrNotConfigured (not a partial config that would fail mid-send).
func LoadFromSettings(ctx context.Context, store Store, encKey []byte, decrypt DecryptFunc) (*Config, error) {
	get := func(k string) string {
		v, err := store.GetSetting(ctx, k)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	if get(KeyEnabled) != "1" {
		return nil, ErrNotConfigured
	}
	cfg := &Config{Enabled: true, Host: get(KeyHost), FromEmail: get(KeyFromEmail)}
	if cfg.Host == "" || cfg.FromEmail == "" || !strings.Contains(cfg.FromEmail, "@") {
		return nil, ErrNotConfigured
	}
	if p := get(KeyPort); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 65535 {
			return nil, fmt.Errorf("mail: port SMTP tidak valid: %q", p)
		}
		cfg.Port = n
	} else {
		cfg.Port = 587
	}
	cfg.TLSMode = get(KeyTLSMode)
	switch cfg.TLSMode {
	case "", "starttls":
		cfg.TLSMode = "starttls"
	case "tls", "none":
	default:
		return nil, fmt.Errorf("mail: mode TLS SMTP tidak dikenal: %q", cfg.TLSMode)
	}
	cfg.Username = get(KeyUsername)
	cfg.FromName = get(KeyFromName)
	if enc := get(KeyPassword); enc != "" {
		if !strings.HasPrefix(enc, "enc:") {
			return nil, errors.New("mail: password SMTP tersimpan dalam format yang tidak dikenal")
		}
		if len(encKey) == 0 || decrypt == nil {
			return nil, errors.New("mail: kunci enkripsi tidak tersedia untuk membaca password SMTP")
		}
		pw, err := decrypt(encKey, strings.TrimPrefix(enc, "enc:"))
		if err != nil {
			return nil, fmt.Errorf("mail: dekripsi password SMTP gagal: %w", err)
		}
		cfg.Password = pw
	}
	return cfg, nil
}

// Send delivers one email. to must be a single address.
func Send(cfg *Config, to, subject, textBody, htmlBody string) error {
	if cfg == nil || !cfg.Enabled {
		return ErrNotConfigured
	}
	if _, err := mail.ParseAddress(to); err != nil {
		return fmt.Errorf("mail: alamat tujuan tidak valid: %w", err)
	}
	if strings.TrimSpace(subject) == "" {
		return errors.New("mail: subjek kosong")
	}
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var client *smtp.Client
	switch cfg.TLSMode {
	case "tls":
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: cfg.Host})
		if err != nil {
			return fmt.Errorf("mail: koneksi TLS ke %s gagal: %w", cfg.Host, err)
		}
		c, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("mail: handshake SMTP gagal: %w", err)
		}
		client = c
	default: // "starttls" dan "none" mulai dengan koneksi polos.
		conn, err := dialer.Dial("tcp", addr)
		if err != nil {
			return fmt.Errorf("mail: koneksi ke %s gagal: %w", cfg.Host, err)
		}
		c, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("mail: handshake SMTP gagal: %w", err)
		}
		client = c
		if cfg.TLSMode == "starttls" {
			if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
				_ = client.Close()
				return fmt.Errorf("mail: STARTTLS ke %s gagal: %w", cfg.Host, err)
			}
		}
	}
	defer client.Close()
	if cfg.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return fmt.Errorf("mail: autentikasi SMTP gagal: %w", err)
		}
	}
	from := cfg.FromEmail
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("mail: perintah MAIL FROM ditolak: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("mail: perintah RCPT TO ditolak: %w", err)
	}
	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("mail: perintah DATA ditolak: %w", err)
	}
	defer wc.Close()
	if _, err := wc.Write(buildMessage(cfg, to, subject, textBody, htmlBody)); err != nil {
		return fmt.Errorf("mail: tulis isi email gagal: %w", err)
	}
	return nil
}

// encodeHeader returns s unchanged when it is plain ASCII, otherwise
// Q-encoded (RFC 2047) so Indonesian text survives in Subject/From.
func encodeHeader(s string) string {
	for _, r := range s {
		if r > 127 {
			return mime.QEncoding.Encode("UTF-8", s)
		}
	}
	return s
}

// buildMessage renders a multipart/alternative message (text + HTML).
func buildMessage(cfg *Config, to, subject, textBody, htmlBody string) []byte {
	boundary := "mutasihub-mail-boundary"
	var b strings.Builder
	from := cfg.FromEmail
	if cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", encodeHeader(cfg.FromName), cfg.FromEmail)
	}
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", encodeHeader(subject))
	b.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n", boundary)
	b.WriteString("\r\n")
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", boundary, textBody)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", boundary, htmlBody)
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return []byte(b.String())
}

// Package config loads runtime configuration from environment variables.
// No secret is ever hardcoded; every credential comes from the environment.
package config

import (
	"os"
	"strings"
)

// Config holds all runtime settings for the MutasiHub backend.
type Config struct {
	Port         string
	MySQLDSN     string
	FrontendURL  string
	CookieDomain string

	JWTSecret     string
	EncryptionKey string

	ConnectaBaseURL       string
	ConnectaAPIKey        string
	ConnectaWebhookSecret string
	ConnectaPartnerID     string

	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	GobizAPIKey        string
	GobizWebhookSecret string

	AdminGoogleEmails []string
}

// withMySQLLoc memastikan DSN membawa loc=Asia/Shanghai bila belum ada.
//
// P1-6 (zona waktu): MySQL live berjalan dengan @@system_time_zone=CST
// (UTC+8) dan Go di server memakai local TZ CST. go-sql-driver mem-parse
// TIMESTAMP maupun DATETIME ke time.Time memakai loc DSN; bila loc tidak
// sama dengan zona sesi MySQL, instant yang dibaca bergeser. loc HARUS
// Asia/Shanghai (= CST/UTC+8, zona sesi MySQL), BUKAN Asia/Jakarta dan
// BUKAN SET time_zone='+07:00' per koneksi: time_zone='+07:00' akan
// membuat MySQL mengonversi TIMESTAMP dan menggeser pembacaan baris
// DATETIME lama sebesar 1 jam, sedangkan loc= hanya mengatur cara Go
// mem-parse nilai yang dikembalikan sesi CST — tanpa mengubah apa pun di
// sisi server. Pemformatan ke WIB dilakukan di lapisan aplikasi, bukan
// di DSN/sesi (lihat parseTxDate di internal/sync).
func withMySQLLoc(dsn string) string {
	if dsn == "" || strings.Contains(dsn, "loc=") {
		return dsn
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + "loc=Asia%2FShanghai"
}

func getenv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// Load reads configuration from the environment.
func Load() *Config {
	var admins []string
	if v := os.Getenv("ADMIN_GOOGLE_EMAILS"); v != "" {
		for _, e := range strings.Split(v, ",") {
			if e = strings.TrimSpace(e); e != "" {
				admins = append(admins, strings.ToLower(e))
			}
		}
	}
	return &Config{
		Port:        getenv("PORT", "8080"),
		MySQLDSN:    withMySQLLoc(os.Getenv("MYSQL_DSN")),
		FrontendURL: getenv("FRONTEND_URL", "http://localhost:3000"),
		// P2-18: COOKIE_DOMAIN sengaja DIABAIKAN server — cookie sesi
		// selalu host-only (lihat Server.cookieDomain). Nilai env ini
		// dipertahankan di struct agar Load() tetap kompatibel, tapi
		// tidak lagi memengaruhi cookie apa pun.
		CookieDomain: os.Getenv("COOKIE_DOMAIN"),

		JWTSecret:     os.Getenv("JWT_SECRET"),
		EncryptionKey: os.Getenv("ENCRYPTION_KEY"),

		ConnectaBaseURL:       strings.TrimRight(getenv("CONNECTA_BASE_URL", ""), "/"),
		ConnectaAPIKey:        os.Getenv("CONNECTA_API_KEY"),
		ConnectaWebhookSecret: os.Getenv("CONNECTA_WEBHOOK_SECRET"),
		ConnectaPartnerID:     os.Getenv("CONNECTA_PARTNER_ID"),

		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"),

		GobizAPIKey:        os.Getenv("GOBIZ_API_KEY"),
		GobizWebhookSecret: os.Getenv("GOBIZ_WEBHOOK_SECRET"),

		AdminGoogleEmails: admins,
	}
}

// IsAdminGoogleEmail reports whether email is on the admin Google allowlist.
func (c *Config) IsAdminGoogleEmail(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, e := range c.AdminGoogleEmails {
		if e == email {
			return true
		}
	}
	return false
}

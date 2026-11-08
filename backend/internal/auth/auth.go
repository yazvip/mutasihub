// Package auth provides password hashing (bcrypt), HMAC-SHA256 JWT
// sessions and TOTP (RFC 6238, HMAC-SHA1, stdlib only).
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- HMAC-SHA1 is mandated by RFC 6238 for TOTP; not used for password hashing.
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword hashes a password with bcrypt.
func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("auth: password must be at least 8 characters")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(h), nil
}

// CheckPassword compares a bcrypt hash with a plaintext password.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Claims carried in a session JWT.
type Claims struct {
	Subject        string `json:"sub"`
	Role           string `json:"role"` // "member" or "admin"
	ExpiresAt      int64  `json:"exp"`
	IssuedAt       int64  `json:"iat"`
	SessionVersion int    `json:"sv,omitempty"`      // members/admin_users.session_version; 0 = token lama tanpa klaim
	Purpose        string `json:"purpose,omitempty"` // "totp-pending" untuk token pending TOTP Google; kosong = sesi biasa
}

// NewJWT signs a session token valid for ttl.
func NewJWT(secret, subject, role string, ttl time.Duration) (string, error) {
	return NewJWTWithVersion(secret, subject, role, 0, ttl)
}

// NewJWTWithVersion signs a session token carrying the member/admin
// session_version (klaim "sv"). Token lama tanpa klaim sv di-decode
// sebagai sv=0, jadi tidak ada logout massal saat deploy.
func NewJWTWithVersion(secret, subject, role string, sv int, ttl time.Duration) (string, error) {
	return newJWTClaims(secret, Claims{Subject: subject, Role: role, SessionVersion: sv}, ttl)
}

// NewTOTPPendingJWT signs a short-lived token for the Google → TOTP
// step: role "totp-pending" (BUKAN "member") sehingga token ini tidak
// pernah bisa dipakai sebagai sesi di authMember/authenticateMutasi.
func NewTOTPPendingJWT(secret, subject string, ttl time.Duration) (string, error) {
	return newJWTClaims(secret, Claims{Subject: subject, Role: "totp-pending", Purpose: "totp-pending"}, ttl)
}

func newJWTClaims(secret string, c Claims, ttl time.Duration) (string, error) {
	if secret == "" {
		return "", errors.New("auth: empty JWT secret")
	}
	now := time.Now()
	c.IssuedAt = now.Unix()
	c.ExpiresAt = now.Add(ttl).Unix()
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("auth: marshal claims: %w", err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	unsigned := enc(header) + "." + enc(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	sig := enc(mac.Sum(nil))
	return unsigned + "." + sig, nil
}

// ValidateJWT verifies signature and expiry and returns the claims.
func ValidateJWT(secret, token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("auth: malformed token")
	}
	enc := base64.RawURLEncoding.EncodeToString
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	want := enc(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return nil, errors.New("auth: invalid token signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("auth: decode payload: %w", err)
	}
	var c Claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("auth: decode claims: %w", err)
	}
	if c.Subject == "" || c.Role == "" {
		return nil, errors.New("auth: token missing subject or role")
	}
	if time.Now().Unix() > c.ExpiresAt {
		return nil, errors.New("auth: token expired")
	}
	return &c, nil
}

// GenerateTOTPSecret creates a random base32 TOTP secret (no padding).
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: random totp secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// TOTPCode computes the 6-digit code for secret at time t.
func TOTPCode(secret string, t time.Time) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", fmt.Errorf("auth: decode totp secret: %w", err)
	}
	counter := uint64(t.Unix() / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1])&0xff)<<16 |
		(uint32(sum[offset+2])&0xff)<<8 |
		uint32(sum[offset+3])&0xff
	return fmt.Sprintf("%06d", code%1000000), nil
}

// VerifyTOTP checks code against the current, previous and next 30s windows.
func VerifyTOTP(secret, code string, t time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	for _, delta := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		want, err := TOTPCode(secret, t.Add(delta))
		if err == nil && hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

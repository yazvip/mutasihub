// Package crypto provides AES-256-GCM encryption (stdlib only) and
// masking helpers for phone numbers / account numbers shown to admins
// and members. Raw credentials are never stored in plaintext.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// ParseKey decodes a 32-byte encryption key given as base64 or hex.
func ParseKey(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("crypto: empty encryption key")
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := hex.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	return nil, fmt.Errorf("crypto: encryption key must be 32 bytes encoded as base64 or hex")
}

// Encrypt encrypts plaintext with AES-256-GCM. Output is base64(nonce|ciphertext).
func Encrypt(key []byte, plaintext string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("crypto: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: new gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("crypto: random nonce: %w", err)
	}
	out := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt reverses Encrypt.
func Decrypt(key []byte, encoded string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("crypto: key must be 32 bytes")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("crypto: base64 decode: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("crypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: new gcm: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("crypto: ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: decrypt: %w", err)
	}
	return string(pt), nil
}

// MaskPhone masks an Indonesian phone number, keeping the first 4 and
// last 2 digits: 081234567890 -> 0812******90.
func MaskPhone(phone string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if len(digits) <= 6 {
		return "****"
	}
	return digits[:4] + strings.Repeat("*", len(digits)-6) + digits[len(digits)-2:]
}

// MaskAccountNumber masks a bank account number, keeping the first 2
// and last 3 digits.
func MaskAccountNumber(acct string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, acct)
	if len(digits) <= 5 {
		return "****"
	}
	return digits[:2] + strings.Repeat("*", len(digits)-5) + digits[len(digits)-3:]
}

// MaskEmail masks the local part of an email address.
func MaskEmail(email string) string {
	at := strings.Index(email, "@")
	if at <= 1 {
		return "****"
	}
	local, domain := email[:at], email[at:]
	if len(local) <= 2 {
		return local[:1] + "****" + domain
	}
	return local[:2] + strings.Repeat("*", len(local)-2) + domain
}

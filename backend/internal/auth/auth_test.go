package auth

import (
	"strings"
	"testing"
	"time"
)

func TestPasswordHashRoundtrip(t *testing.T) {
	h, err := HashPassword("correct-horse-123")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "correct-horse-123") {
		t.Fatal("valid password rejected")
	}
	if CheckPassword(h, "wrong-password") {
		t.Fatal("wrong password accepted")
	}
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password accepted")
	}
}

func TestJWTRoundtripAndTamper(t *testing.T) {
	secret := "test-jwt-secret-long-enough"
	tok, err := NewJWT(secret, "member-123", "member", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ValidateJWT(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.Subject != "member-123" || c.Role != "member" {
		t.Fatalf("claims = %+v", c)
	}
	// Tampered payload must fail.
	parts := strings.Split(tok, ".")
	tampered := parts[0] + "." + parts[1] + "A." + parts[2]
	if _, err := ValidateJWT(secret, tampered); err == nil {
		t.Fatal("tampered token accepted")
	}
	// Wrong secret must fail.
	if _, err := ValidateJWT("other-secret", tok); err == nil {
		t.Fatal("token validated with wrong secret")
	}
	// Expired token must fail.
	expired, err := NewJWT(secret, "member-123", "member", -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateJWT(secret, expired); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestTOTPVerify(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	code, err := TOTPCode(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("code = %q, want 6 digits", code)
	}
	if !VerifyTOTP(secret, code, now) {
		t.Fatal("current TOTP code rejected")
	}
	if VerifyTOTP(secret, "000000", now) && code != "000000" {
		t.Fatal("wrong TOTP code accepted")
	}
	if _, err := TOTPCode("not-valid-base32!!!", now); err == nil {
		t.Fatal("invalid secret accepted")
	}
}

// P1-2 (v21): klaim "sv" ikut dalam JWT; token lama tanpa klaim sv
// di-decode sebagai sv=0 agar tidak logout massal saat deploy.
func TestJWTSessionVersion(t *testing.T) {
	secret := "test-jwt-secret-long-enough"
	tok, err := NewJWTWithVersion(secret, "member-1", "member", 3, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ValidateJWT(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.SessionVersion != 3 {
		t.Fatalf("SessionVersion = %d, want 3", c.SessionVersion)
	}
	// Token lama (NewJWT tanpa sv) -> sv 0.
	old, err := NewJWT(secret, "member-1", "member", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	oc, err := ValidateJWT(secret, old)
	if err != nil {
		t.Fatal(err)
	}
	if oc.SessionVersion != 0 {
		t.Fatalf("legacy SessionVersion = %d, want 0", oc.SessionVersion)
	}
}

// P1-3 (v21): token pending TOTP bukan sesi member — role dan purpose
// "totp-pending", TTL singkat.
func TestTOTPPendingJWT(t *testing.T) {
	secret := "test-jwt-secret-long-enough"
	tok, err := NewTOTPPendingJWT(secret, "member-1", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ValidateJWT(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.Role != "totp-pending" || c.Purpose != "totp-pending" {
		t.Fatalf("pending claims = role %q purpose %q", c.Role, c.Purpose)
	}
	if c.Subject != "member-1" {
		t.Fatalf("Subject = %q", c.Subject)
	}
}

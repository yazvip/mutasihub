package crypto

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestMaskPhone(t *testing.T) {
	if got := MaskPhone("081234567890"); got != "0812******90" {
		t.Fatalf("MaskPhone = %q, want 0812******90", got)
	}
	if got := MaskPhone("08123"); got != "****" {
		t.Fatalf("MaskPhone short = %q, want ****", got)
	}
	if strings.Contains(MaskPhone("081234567890"), "345678") {
		t.Fatal("MaskPhone leaked middle digits")
	}
}

func TestMaskAccountNumber(t *testing.T) {
	if got := MaskAccountNumber("8820019283"); got != "88*****283" {
		t.Fatalf("MaskAccountNumber = %q, want 88*****283", got)
	}
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	ct, err := Encrypt(key, `{"phone":"081234567890"}`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ct, "081234567890") {
		t.Fatal("ciphertext leaks plaintext")
	}
	pt, err := Decrypt(key, ct)
	if err != nil {
		t.Fatal(err)
	}
	if pt != `{"phone":"081234567890"}` {
		t.Fatalf("roundtrip = %q", pt)
	}
	// Wrong key must fail.
	wrong := make([]byte, 32)
	for i := range wrong {
		wrong[i] = byte(255 - i)
	}
	if _, err := Decrypt(wrong, ct); err == nil {
		t.Fatal("decrypt with wrong key succeeded")
	}
}

func TestParseKeyBase64AndHex(t *testing.T) {
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i + 1)
	}
	b64 := base64.StdEncoding.EncodeToString(raw)
	k, err := ParseKey(b64)
	if err != nil || len(k) != 32 {
		t.Fatalf("ParseKey base64: %v", err)
	}
	if _, err := ParseKey("too-short"); err == nil {
		t.Fatal("ParseKey accepted a short key")
	}
}

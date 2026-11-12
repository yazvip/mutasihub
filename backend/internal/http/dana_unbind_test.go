package http

import (
	"encoding/json"
	"testing"
)

// TestDanaUnbindNotFound mengunci bentuk error 400 ACCOUNT_NOT_FOUND
// dari POST /b2b/dana/unbind (v46, terverifikasi live 12 Nov 2026
// dengan nomor dummy): field-nya "error" (seperti profile, bukan
// "code" seperti reversal). Handler memetakannya ke lanjut-hapus-lokal.
func TestDanaUnbindNotFound(t *testing.T) {
	raw := []byte(`{"error":"ACCOUNT_NOT_FOUND","message":"Akun DANA tidak ditemukan atau ID tidak diberikan","success":false}`)
	var body struct {
		Err string `json:"error"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Err != "ACCOUNT_NOT_FOUND" {
		t.Errorf("Err = %q, want ACCOUNT_NOT_FOUND", body.Err)
	}
}

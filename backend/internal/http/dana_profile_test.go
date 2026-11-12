package http

import (
	"encoding/json"
	"testing"
)

// TestDanaProfileResp mengunci bentuk respons POST /b2b/dana/profile
// (v45, terverifikasi live 12 Nov 2026): sukses berisi nama tersamar,
// level KYC, status, dan terakhir diperbarui; nomor HP di respons
// TIDAK dipakai (demo = nomor default, produksi = nomor tersamar).
func TestDanaProfileResp(t *testing.T) {
	raw := []byte(`{"data":{"account_id":"acc-27207990-3146-4832-bac8-878bd5be41eb","account_name":"AND**** SET***** SUB****","kyc_level":"PREMIUM","phone":"08112311232","phone_number":"08112311232","status":"ACTIVE","updated_at":"2026-11-12T21:19:10+07:00"},"message":"Profil akun DANA berhasil dimuat","success":true}`)
	var p danaProfileResp
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !p.Success {
		t.Fatalf("Success = false, want true")
	}
	if p.Data.AccountName != "AND**** SET***** SUB****" {
		t.Errorf("AccountName = %q", p.Data.AccountName)
	}
	if p.Data.KYCLevel != "PREMIUM" {
		t.Errorf("KYCLevel = %q, want PREMIUM", p.Data.KYCLevel)
	}
	if p.Data.Status != "ACTIVE" {
		t.Errorf("Status = %q, want ACTIVE", p.Data.Status)
	}
	if p.Data.UpdatedAt != "2026-11-12T21:19:10+07:00" {
		t.Errorf("UpdatedAt = %q", p.Data.UpdatedAt)
	}
}

// TestDanaProfileNotFound mengunci bentuk error 400 ACCOUNT_NOT_FOUND
// (nomor tidak ada di data partner) — handler memetakannya ke 404
// profile_not_found, bukan 502.
func TestDanaProfileNotFound(t *testing.T) {
	raw := []byte(`{"error":"ACCOUNT_NOT_FOUND","message":"akun DANA dengan nomor 087841903677 tidak ditemukan di data partner Anda","success":false}`)
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

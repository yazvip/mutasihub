package http

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSubstitutePlaceholders(t *testing.T) {
	vars := map[string]string{"nama": "Andi <b>Pratama</b>", "paket": "Pro"}
	got := substitutePlaceholders("Halo, {{nama}} — paket {{paket}}.", vars, true)
	if want := "Halo, Andi &lt;b&gt;Pratama&lt;/b&gt; — paket Pro."; got != want {
		t.Fatalf("escape: got %q, want %q", got, want)
	}
	// Subjek memakai nilai mentah (header teks polos, bukan HTML).
	got = substitutePlaceholders("Paket {{paket}} — {{nama}}", vars, false)
	if want := "Paket Pro — Andi <b>Pratama</b>"; got != want {
		t.Fatalf("mentah: got %q, want %q", got, want)
	}
	// Placeholder tak dikenal dibiarkan apa adanya (typo kelihatan).
	got = substitutePlaceholders("Halo {{nama}}, kode {{kode}}.", vars, true)
	if !strings.Contains(got, "{{kode}}") {
		t.Fatalf("tak dikenal harus dibiarkan: got %q", got)
	}
	// Spasi di dalam kurung diizinkan.
	got = substitutePlaceholders("Halo, {{ nama }}.", vars, true)
	if !strings.Contains(got, "Andi &lt;b&gt;") {
		t.Fatalf("spasi dalam kurung: got %q", got)
	}
}

func TestHTMLToText(t *testing.T) {
	html := `<p>Halo, Andi,</p><p>Tekan tombol ini:</p><p><a href="https://mutasi.rajacek.com/verify-email?token=x" style="display:inline-block">Verifikasi Email</a></p><p><strong>Paket:</strong> Pro<br><strong>Jumlah:</strong> Rp900.000</p>`
	text := htmlToText(html)
	if !strings.Contains(text, "Verifikasi Email (https://mutasi.rajacek.com/verify-email?token=x)") {
		t.Fatalf("tautan harus dipertahankan sebagai label (url): got %q", text)
	}
	if !strings.Contains(text, "Paket: Pro") || !strings.Contains(text, "Jumlah: Rp900.000") {
		t.Fatalf("tag strong/br harus jadi teks rapi: got %q", text)
	}
	if strings.Contains(text, "<") || strings.Contains(text, ">") {
		t.Fatalf("tidak boleh ada sisa tag: got %q", text)
	}
	if strings.Contains(htmlToText(`<p>Lihat &amp; Bayar</p>`), "&amp;") {
		t.Fatalf("entitas harus di-unescape")
	}
}

func TestResolveTemplate(t *testing.T) {
	def, _ := defaultEmailTemplate("email_verification")
	// Baris DB menang bila lengkap.
	subj, body := resolveTemplate(def, "Subjek custom", "<p>Isi custom</p>", true)
	if subj != "Subjek custom" || body != "<p>Isi custom</p>" {
		t.Fatalf("baris DB harus menang: got %q / %q", subj, body)
	}
	// Baris kosong -> default.
	subj, body = resolveTemplate(def, "", "", true)
	if subj != def.Subject || body != def.BodyHTML {
		t.Fatalf("baris kosong harus fallback ke default")
	}
	subj, body = resolveTemplate(def, "Subjek saja", "", true)
	if subj != def.Subject {
		t.Fatalf("subjek saja tanpa isi harus fallback ke default")
	}
	// Baris tidak ada -> default.
	subj, body = resolveTemplate(def, "", "", false)
	if subj != def.Subject || body != def.BodyHTML {
		t.Fatalf("tanpa baris harus fallback ke default")
	}
}

func TestDefaultTemplatesRender(t *testing.T) {
	s := noDBServer()
	ctx := context.Background()
	if len(defaultEmailTemplates) != 7 {
		t.Fatalf("want 7 template default, got %d", len(defaultEmailTemplates))
	}
	for _, def := range defaultEmailTemplates {
		vars := s.sampleTemplateVars(def.Key)
		for _, ph := range def.Placeholders {
			if _, ok := vars[ph]; !ok {
				t.Fatalf("%s: placeholder %q tidak ada di data contoh", def.Key, ph)
			}
		}
		subj, text, htmlBody := s.renderEmailTemplate(ctx, def.Key, vars)
		if subj == "" || text == "" || htmlBody == "" {
			t.Fatalf("%s: hasil render kosong", def.Key)
		}
		if strings.Contains(subj, "{{") || strings.Contains(htmlBody, "{{") {
			t.Fatalf("%s: masih ada placeholder tak terganti di subjek/body", def.Key)
		}
		if !strings.Contains(htmlBody, "MutasiHub") {
			t.Fatalf("%s: hasil render harus dibungkus shell brand", def.Key)
		}
		for _, need := range def.Required {
			if !strings.Contains(def.BodyHTML, "{{"+need+"}}") {
				t.Fatalf("%s: default wajib memuat placeholder {{%s}}", def.Key, need)
			}
		}
	}
	// Verifikasi: tautan harus sampai ke teks polos.
	_, text, _ := s.renderEmailTemplate(ctx, "email_verification", s.sampleTemplateVars("email_verification"))
	if !strings.Contains(text, "https://mutasi.rajacek.com/verify-email?token=contoh") {
		t.Fatalf("teks verifikasi harus memuat tautan: got %q", text)
	}
}

// TestMigrationSeedMatchesDefaults menjaga seed migrasi 0017 tetap
// sama dengan default kode: subjek + satu cuplikan khas tiap isi
// harus muncul di file SQL.
func TestMigrationSeedMatchesDefaults(t *testing.T) {
	sql, err := os.ReadFile("../../migrations/0017_email_templates_v39.sql")
	if err != nil {
		t.Fatalf("baca migrasi 0017: %v", err)
	}
	snippets := map[string]string{
		"email_verification":   "Terima kasih sudah mendaftar di MutasiHub",
		"password_reset":       "membuat password baru. Tautan ini berlaku 1 jam",
		"order_pending":        "Lihat Tagihan &amp; Bayar",
		"order_paid":           "kini aktif sampai",
		"expiry_reminder_h3":   "3 hari lagi",
		"expiry_reminder_h1":   "berakhir <strong>besok",
		"subscription_expired": "telah berakhir pada",
	}
	for _, def := range defaultEmailTemplates {
		if !strings.Contains(string(sql), "'"+def.Key+"'") {
			t.Fatalf("seed migrasi tidak memuat key %q", def.Key)
		}
		if !strings.Contains(string(sql), def.Subject) {
			t.Fatalf("seed migrasi tidak memuat subjek default %q", def.Subject)
		}
		if !strings.Contains(string(sql), snippets[def.Key]) {
			t.Fatalf("seed migrasi tidak memuat cuplikan isi default %q", def.Key)
		}
	}
}

func TestSameTemplateContent(t *testing.T) {
	if !sameTemplateContent("<p>Halo,\nAndi</p>", "<p>Halo, Andi</p>") {
		t.Fatalf("perbedaan whitespace saja harus dianggap sama")
	}
	if sameTemplateContent("<p>Halo, Andi</p>", "<p>Halo, Budi</p>") {
		t.Fatalf("isi berbeda harus dianggap berbeda")
	}
}

// --- v39b: kirim tes per template ---

func TestRenderTemplateContent(t *testing.T) {
	vars := map[string]string{
		"nama":   "Andi <b>Pratama</b>",
		"paket":  "Pro",
		"tautan": "https://mutasi.rajacek.com/verify-email?token=contoh",
	}
	subj, text, htmlBody := renderTemplateContent(
		"Verifikasi email — paket {{paket}}",
		`<p>Halo, {{nama}},</p><p>Tekan <a href="{{tautan}}">tautan ini</a> atau abaikan {{kode}}.</p>`, vars)
	if subj != "Verifikasi email — paket Pro" {
		t.Fatalf("subjek: got %q", subj)
	}
	if !strings.Contains(htmlBody, "Andi &lt;b&gt;Pratama&lt;/b&gt;") {
		t.Fatalf("nilai harus di-escape di badan: got %q", htmlBody)
	}
	if !strings.Contains(htmlBody, "MutasiHub") {
		t.Fatalf("hasil harus dibungkus shell brand")
	}
	if !strings.Contains(htmlBody, "{{kode}}") {
		t.Fatalf("placeholder tak dikenal harus dibiarkan apa adanya")
	}
	if !strings.Contains(text, "tautan ini (https://mutasi.rajacek.com/verify-email?token=contoh)") {
		t.Fatalf("teks harus memuat tautan sebagai label (url): got %q", text)
	}
	if strings.Contains(text, "<p>") || strings.Contains(text, "<a ") {
		t.Fatalf("teks tidak boleh berisi tag: got %q", text)
	}
}

func TestValidateTemplateTestInput(t *testing.T) {
	// Valid: email + isi editor lengkap.
	if _, _, _, msg := validateTemplateTestInput("admin@rajacek.com", "Subjek {{paket}}", "<p>Isi</p>"); msg != "" {
		t.Fatalf("input valid ditolak: %q", msg)
	}
	// Valid: email saja (pakai template tersimpan).
	if _, _, _, msg := validateTemplateTestInput(" admin@rajacek.com ", "", ""); msg != "" {
		t.Fatalf("email saja harus valid: %q", msg)
	}
	// Tidak valid: alamat tujuan.
	for _, bad := range []string{"", "bukan-email", "a@b", "a b@c.id", "a@b c.id", "a@@b.id"} {
		if _, _, _, msg := validateTemplateTestInput(bad, "S", "<p>B</p>"); msg == "" {
			t.Fatalf("alamat %q harus ditolak", bad)
		}
	}
	// Terlalu panjang: subjek >255, isi >20000.
	if _, _, _, msg := validateTemplateTestInput("a@b.id", strings.Repeat("x", 256), "<p>B</p>"); msg == "" {
		t.Fatalf("subjek >255 harus ditolak")
	}
	if _, _, _, msg := validateTemplateTestInput("a@b.id", "S", strings.Repeat("x", 20001)); msg == "" {
		t.Fatalf("isi >20000 harus ditolak")
	}
	// Batas atas yang masih lolos.
	if _, _, _, msg := validateTemplateTestInput("a@b.id", strings.Repeat("x", 255), strings.Repeat("x", 20000)); msg != "" {
		t.Fatalf("batas atas harus lolos: %q", msg)
	}
}

// --- v39c: crash halaman template (null.length) ---

// TestTemplateRowNeverNullArrays menjaga list + detail tidak pernah
// mengembalikan "placeholders":null atau "required_placeholders":null:
// 5 template tanpa Required (slice Go nil) dulu lolos sebagai null dan
// frontend crash di selected.required_placeholders.length. Kedua handler
// (list + detail) sama-sama memanggil templateRow, jadi menguji
// templateRow mencakup keduanya.
func TestTemplateRowNeverNullArrays(t *testing.T) {
	s := noDBServer()
	if len(defaultEmailTemplates) != 7 {
		t.Fatalf("want 7 template default, got %d", len(defaultEmailTemplates))
	}
	for _, def := range defaultEmailTemplates {
		row := s.templateRow(def, def.Subject, def.BodyHTML, time.Time{})
		if row.Placeholders == nil {
			t.Fatalf("%s: Placeholders nil", def.Key)
		}
		if row.Required == nil {
			t.Fatalf("%s: Required nil", def.Key)
		}
		b, err := json.Marshal(row)
		if err != nil {
			t.Fatalf("%s: marshal: %v", def.Key, err)
		}
		js := string(b)
		if strings.Contains(js, `"placeholders":null`) {
			t.Fatalf("%s: JSON berisi placeholders:null: %s", def.Key, js)
		}
		if strings.Contains(js, `"required_placeholders":null`) {
			t.Fatalf("%s: JSON berisi required_placeholders:null: %s", def.Key, js)
		}
	}
	// 5 template tanpa Required wajib terserialisasi sebagai [].
	for _, key := range []string{"order_pending", "order_paid", "expiry_reminder_h3", "expiry_reminder_h1", "subscription_expired"} {
		def, ok := defaultEmailTemplate(key)
		if !ok {
			t.Fatalf("template %q tidak ditemukan", key)
		}
		row := s.templateRow(def, def.Subject, def.BodyHTML, time.Time{})
		b, _ := json.Marshal(row)
		if !strings.Contains(string(b), `"required_placeholders":[]`) {
			t.Fatalf("%s: Required kosong harus jadi []: %s", key, b)
		}
	}
}

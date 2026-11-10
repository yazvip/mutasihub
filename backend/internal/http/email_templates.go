// Template email yang bisa dicustom admin (v39).
//
// Isi email TIDAK LAGI hardcode di sendXxxEmail: subjek + isi HTML
// tiap jenis email disimpan di tabel email_templates dan bisa diubah
// admin dari /admin/email-templates. Default premium di bawah ini
// adalah satu-satunya sumber kebenaran untuk isi awal (di-seed ke DB
// oleh migrasi 0017) sekaligus fallback bila baris template hilang
// atau kosong — email TIDAK BOLEH gagal hanya karena template belum
// diisi.
//
// Placeholder {{...}} diganti nilai aktual saat render; nilai selalu
// di-escape HTML di badan email (subjek memakai nilai mentah karena
// subjek adalah header teks polos). Placeholder yang tidak dikenal
// dibiarkan apa adanya supaya typo kelihatan di pratinjau. Teks polos
// diturunkan otomatis dari HTML (tautan dipertahankan sebagai
// "label (url)") agar satu sumber kebenaran.
package http

import (
	"context"
	"database/sql"
	"errors"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"

	"mutasi-hub/internal/mail"
)

// emailTemplateDef mendeskripsikan satu jenis email: key = nilai `kind`
// yang dipakai sendMail; Label = nama tampil di panel admin;
// Placeholders = variabel yang berlaku; Required = placeholder yang
// wajib ada di isi (fungsional — tanpanya email kehilangan tautan).
type emailTemplateDef struct {
	Key          string
	Label        string
	Subject      string
	BodyHTML     string
	Placeholders []string
	Required     []string
}

// defaultEmailTemplates — urutan ini juga urutan tampil di panel admin.
var defaultEmailTemplates = []emailTemplateDef{
	{
		Key:     "email_verification",
		Label:   "Verifikasi Email",
		Subject: "Verifikasi email Anda — MutasiHub",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Terima kasih sudah mendaftar di MutasiHub — platform cek mutasi rekening dan rekening bank secara realtime.</p>
<p>Untuk mengaktifkan akun Anda, silakan verifikasi alamat email ini dengan menekan tombol di bawah. Tautan verifikasi berlaku 24 jam.</p>
<p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verifikasi Email</a></p>
<p style="font-size:13px;color:#64748b">Bila tombol di atas tidak berfungsi, salin tautan berikut ke peramban Anda:<br>{{tautan}}</p>
<p>Bila Anda tidak merasa mendaftar di MutasiHub, abaikan email ini — tidak ada tindakan yang perlu dilakukan.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "tautan"},
		Required:     []string{"tautan"},
	},
	{
		Key:     "password_reset",
		Label:   "Reset Password",
		Subject: "Reset password MutasiHub",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Kami menerima permintaan untuk mereset password akun MutasiHub Anda. Tekan tombol di bawah ini untuk membuat password baru. Tautan ini berlaku 1 jam.</p>
<p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Reset Password</a></p>
<p style="font-size:13px;color:#64748b">Bila tombol di atas tidak berfungsi, salin tautan berikut ke peramban Anda:<br>{{tautan}}</p>
<p>Bila Anda tidak meminta reset password, abaikan email ini — password Anda tetap aman dan tidak berubah.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "tautan"},
		Required:     []string{"tautan"},
	},
	{
		Key:     "order_pending",
		Label:   "Tagihan Menunggu Pembayaran",
		Subject: "Tagihan paket {{paket}} — menunggu pembayaran",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Tagihan langganan MutasiHub Anda sudah dibuat. Berikut rinciannya:</p>
<p><strong>Paket:</strong> {{paket}}<br><strong>Jumlah:</strong> {{jumlah}}<br><strong>ID order:</strong> {{order_id}}</p>
<p>Tagihan ini berlaku 24 jam. Segera selesaikan pembayaran agar paket langsung aktif dan layanan tidak tertunda.</p>
<p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Lihat Tagihan &amp; Bayar</a></p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "paket", "jumlah", "order_id", "tautan"},
	},
	{
		Key:     "order_paid",
		Label:   "Pembayaran Berhasil",
		Subject: "Pembayaran berhasil — paket {{paket}} aktif",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Pembayaran Anda sudah kami terima. Paket <strong>{{paket}}</strong> kini aktif sampai <strong>{{berlaku_sampai}}</strong>.</p>
<p>Seluruh layanan MutasiHub — sinkronisasi mutasi dan cek rekening — sudah dapat Anda gunakan.</p>
<p>Terima kasih sudah berlangganan MutasiHub.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "paket", "berlaku_sampai"},
	},
	{
		Key:     "expiry_reminder_h3",
		Label:   "Pengingat Paket Berakhir 3 Hari Lagi",
		Subject: "Paket {{paket}} berakhir 3 hari lagi — MutasiHub",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Paket <strong>{{paket}}</strong> Anda berakhir pada <strong>{{berlaku_sampai}}</strong> ({{sisa_hari}} hari lagi).</p>
<p>Perpanjang langganan sekarang agar sinkronisasi mutasi dan cek rekening tetap berjalan tanpa terputus.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "paket", "berlaku_sampai", "sisa_hari"},
	},
	{
		Key:     "expiry_reminder_h1",
		Label:   "Pengingat Paket Berakhir Besok",
		Subject: "Paket {{paket}} berakhir besok — MutasiHub",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Paket <strong>{{paket}}</strong> Anda berakhir <strong>besok, {{berlaku_sampai}}</strong>.</p>
<p>Perpanjang sekarang agar layanan tidak terputus.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "paket", "berlaku_sampai", "sisa_hari"},
	},
	{
		Key:     "subscription_expired",
		Label:   "Paket Telah Berakhir",
		Subject: "Paket {{paket}} telah berakhir — MutasiHub",
		BodyHTML: `<p>Halo, {{nama}},</p>
<p>Paket <strong>{{paket}}</strong> Anda telah berakhir pada <strong>{{berlaku_sampai}}</strong>.</p>
<p>Perpanjang langganan Anda agar sinkronisasi mutasi dan cek rekening kembali berjalan.</p>
<p>Salam,<br>Tim MutasiHub</p>`,
		Placeholders: []string{"nama", "paket", "berlaku_sampai"},
	},
}

func defaultEmailTemplate(key string) (emailTemplateDef, bool) {
	for _, d := range defaultEmailTemplates {
		if d.Key == key {
			return d, true
		}
	}
	return emailTemplateDef{}, false
}

// --- render (pure, bisa dites tanpa DB) ---

var placeholderRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_]+)\s*\}\}`)
var htmlTagRe = regexp.MustCompile(`<[^>]*>`)
var htmlLinkRe = regexp.MustCompile(`(?i)<a\s[^>]*href="([^"]*)"[^>]*>(.*?)</a>`)
var multiNLRe = regexp.MustCompile(`\n{3,}`)

// substitutePlaceholders mengganti {{nama}} dengan nilainya. Bila
// escape=true nilai di-escape HTML (badan email); bila false nilai
// dipakai mentah (subjek = header teks polos). Placeholder yang tidak
// ada di vars dibiarkan apa adanya.
func substitutePlaceholders(s string, vars map[string]string, escape bool) string {
	return placeholderRe.ReplaceAllStringFunc(s, func(m string) string {
		key := placeholderRe.FindStringSubmatch(m)[1]
		v, ok := vars[key]
		if !ok {
			return m
		}
		if escape {
			return html.EscapeString(v)
		}
		return v
	})
}

// placeholdersUsed mengembalikan himpunan placeholder yang muncul di s.
func placeholdersUsed(s string) map[string]bool {
	out := map[string]bool{}
	for _, m := range placeholderRe.FindAllStringSubmatch(s, -1) {
		out[m[1]] = true
	}
	return out
}

// htmlToText menurunkan teks polos dari HTML: tautan dipertahankan
// sebagai "label (url)" agar tombol tetap berguna di klien teks,
// <br> dan </p> jadi baris baru, tag lain dihapus, entitas di-unescape.
func htmlToText(h string) string {
	s := htmlLinkRe.ReplaceAllString(h, "$2 ($1)")
	s = strings.ReplaceAll(s, "<br>", "\n")
	s = strings.ReplaceAll(s, "<br/>", "\n")
	s = strings.ReplaceAll(s, "<br />", "\n")
	s = strings.ReplaceAll(s, "</p>", "\n\n")
	s = htmlTagRe.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = multiNLRe.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}

// resolveTemplate menggabungkan baris DB dengan default: baris DB
// menang bila ada dan subjek + isi tidak kosong; bila tidak, default
// kode dipakai (fallback — email tidak boleh gagal karena template).
func resolveTemplate(def emailTemplateDef, dbSubject, dbBody string, hasRow bool) (string, string) {
	if !hasRow || strings.TrimSpace(dbSubject) == "" || strings.TrimSpace(dbBody) == "" {
		return def.Subject, def.BodyHTML
	}
	return dbSubject, dbBody
}

// sameTemplateContent membandingkan dua isi template dengan
// mengabaikan perbedaan whitespace (baris baru vs spasi) — seed
// migrasi dan default kode boleh berbeda format, isinya yang dinilai.
func sameTemplateContent(a, b string) bool {
	norm := func(s string) string { return strings.Join(strings.Fields(s), " ") }
	return norm(a) == norm(b)
}

// --- muat + render (butuh DB, fallback ke default) ---

// loadEmailTemplate membaca subjek + isi dari DB; bila DB tidak
// tersedia, baris tidak ada, atau isinya kosong, kembalikan default.
func (s *Server) loadEmailTemplate(ctx context.Context, def emailTemplateDef) (string, string) {
	if !s.store.Available() {
		return def.Subject, def.BodyHTML
	}
	var subj, body sql.NullString
	err := s.store.DB.QueryRowContext(ctx,
		"SELECT subject, body_html FROM email_templates WHERE `key`=?", def.Key).Scan(&subj, &body)
	if err != nil {
		return def.Subject, def.BodyHTML
	}
	return resolveTemplate(def, subj.String, body.String, true)
}

// renderTemplateContent mengganti placeholder di subjek + isi, lalu
// membungkus dengan emailShell. Mengembalikan (subjek, teks, HTML).
// Pure — dipakai renderEmailTemplate (template tersimpan) maupun
// kirim tes (isi editor saat itu).
func renderTemplateContent(subject, bodyHTML string, vars map[string]string) (string, string, string) {
	subj := substitutePlaceholders(subject, vars, false)
	body := substitutePlaceholders(bodyHTML, vars, true)
	text, htmlBody := emailShell(body, htmlToText(body))
	return subj, text, htmlBody
}

// renderEmailTemplate memuat template, mengganti placeholder, lalu
// membungkus dengan emailShell. Mengembalikan (subjek, teks, HTML).
func (s *Server) renderEmailTemplate(ctx context.Context, key string, vars map[string]string) (string, string, string) {
	def, ok := defaultEmailTemplate(key)
	if !ok {
		return "", "", ""
	}
	subj, body := s.loadEmailTemplate(ctx, def)
	return renderTemplateContent(subj, body, vars)
}

// memberDisplayName mengambil nama member untuk sapaan {{nama}}:
// nama di profil bila ada, bila tidak bagian sebelum @ pada email,
// terakhir "Pelanggan".
func (s *Server) memberDisplayName(ctx context.Context, memberID, email string) string {
	if s.store.Available() && memberID != "" {
		var name sql.NullString
		if err := s.store.DB.QueryRowContext(ctx,
			`SELECT name FROM members WHERE id=?`, memberID).Scan(&name); err == nil {
			if v := strings.TrimSpace(name.String); v != "" {
				return v
			}
		}
	}
	if i := strings.Index(email, "@"); i > 0 {
		return email[:i]
	}
	return "Pelanggan"
}

// sampleTemplateVars memberi data contoh untuk pratinjau — mencakup
// semua placeholder tiap template sehingga tidak ada {{...}} tersisa.
func (s *Server) sampleTemplateVars(key string) map[string]string {
	vars := map[string]string{
		"nama":           "Andi Pratama",
		"paket":          "Pro",
		"jumlah":         "Rp900.000",
		"order_id":       "ord_contoh123",
		"tautan":         s.frontendURL() + "/verify-email?token=contoh",
		"berlaku_sampai": formatWIB(time.Now().AddDate(0, 1, 0)),
		"sisa_hari":      "3",
	}
	switch key {
	case "password_reset":
		vars["tautan"] = s.frontendURL() + "/reset-password?token=contoh"
	case "order_pending":
		vars["tautan"] = s.frontendURL() + "/member/subscription"
	case "expiry_reminder_h1":
		vars["sisa_hari"] = "1"
	}
	return vars
}

// --- handler admin ---

type emailTemplateRow struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	Subject      string   `json:"subject"`
	BodyHTML     string   `json:"body_html"`
	Placeholders []string `json:"placeholders"`
	Required     []string `json:"required_placeholders"`
	Customized   bool     `json:"customized"`
	UpdatedAt    string   `json:"updated_at"`
}

// nonNilStrings mengembalikan slice kosong (bukan nil) agar JSON selalu
// berisi [] bukan null — frontend memanggil .length/.map pada kedua
// array ini; null.length melempar TypeError dan halaman crash (v39c:
// 5 template tanpa Required mengembalikan "required_placeholders":null).
func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func (s *Server) templateRow(def emailTemplateDef, subj, body string, updatedAt time.Time) emailTemplateRow {
	return emailTemplateRow{
		Key:          def.Key,
		Label:        def.Label,
		Subject:      subj,
		BodyHTML:     body,
		Placeholders: nonNilStrings(def.Placeholders),
		Required:     nonNilStrings(def.Required),
		Customized:   !sameTemplateContent(subj, def.Subject) || !sameTemplateContent(body, def.BodyHTML),
		UpdatedAt:    formatWIB(updatedAt),
	}
}

func (s *Server) handleAdminListEmailTemplates(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(),
		"SELECT `key`, subject, body_html, updated_at FROM email_templates")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca template email")
		return
	}
	defer rows.Close()
	byKey := map[string]emailTemplateRow{}
	for rows.Next() {
		var k, subj, body string
		var updated time.Time
		if err := rows.Scan(&k, &subj, &body, &updated); err != nil {
			continue
		}
		def, ok := defaultEmailTemplate(k)
		if !ok {
			continue
		}
		byKey[k] = s.templateRow(def, subj, body, updated)
	}
	out := make([]emailTemplateRow, 0, len(defaultEmailTemplates))
	for _, def := range defaultEmailTemplates {
		if row, ok := byKey[def.Key]; ok {
			out = append(out, row)
			continue
		}
		// Baris belum ter-seed: tampilkan default (customized=false).
		out = append(out, s.templateRow(def, def.Subject, def.BodyHTML, time.Time{}))
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": out})
}

func (s *Server) handleAdminGetEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	key := r.PathValue("key")
	def, ok := defaultEmailTemplate(key)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "template email tidak ditemukan")
		return
	}
	subj, body := s.loadEmailTemplate(r.Context(), def)
	var updated time.Time
	_ = s.store.DB.QueryRowContext(r.Context(),
		"SELECT updated_at FROM email_templates WHERE `key`=?", key).Scan(&updated)
	writeJSON(w, http.StatusOK, s.templateRow(def, subj, body, updated))
}

func (s *Server) handleAdminUpdateEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	key := r.PathValue("key")
	def, ok := defaultEmailTemplate(key)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "template email tidak ditemukan")
		return
	}
	var req struct {
		Subject  string `json:"subject"`
		BodyHTML string `json:"body_html"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.BodyHTML = strings.TrimSpace(req.BodyHTML)
	if req.Subject == "" || req.BodyHTML == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "subjek dan isi template wajib diisi")
		return
	}
	if len(req.Subject) > 255 || len(req.BodyHTML) > 20000 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "subjek maks 255 karakter, isi maks 20000 karakter")
		return
	}
	used := placeholdersUsed(req.BodyHTML)
	for _, need := range def.Required {
		if !used[need] {
			writeErr(w, http.StatusBadRequest, "invalid_input", "template ini wajib memuat {{"+need+"}} agar tautan tetap terkirim")
			return
		}
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO email_templates
		(`+"`key`"+`, subject, body_html) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE subject=VALUES(subject), body_html=VALUES(body_html)`,
		key, req.Subject, req.BodyHTML); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan template email")
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "email_template_update", "template email diperbarui: "+key)
	writeJSON(w, http.StatusOK, map[string]any{"message": "template email disimpan", "key": key})
}

func (s *Server) handleAdminResetEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	key := r.PathValue("key")
	def, ok := defaultEmailTemplate(key)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "template email tidak ditemukan")
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO email_templates
		(`+"`key`"+`, subject, body_html) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE subject=VALUES(subject), body_html=VALUES(body_html)`,
		key, def.Subject, def.BodyHTML); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mereset template email")
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "email_template_reset", "template email direset ke default: "+key)
	writeJSON(w, http.StatusOK, map[string]any{"message": "template email direset ke default", "key": key})
}

// handleAdminPreviewEmailTemplate merender template dengan data contoh
// dan mengembalikan hasilnya — TANPA mengirim email apa pun.
func (s *Server) handleAdminPreviewEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	key := r.PathValue("key")
	if _, ok := defaultEmailTemplate(key); !ok {
		writeErr(w, http.StatusNotFound, "not_found", "template email tidak ditemukan")
		return
	}
	subj, text, htmlBody := s.renderEmailTemplate(r.Context(), key, s.sampleTemplateVars(key))
	writeJSON(w, http.StatusOK, map[string]any{
		"key":     key,
		"subject": subj,
		"text":    text,
		"html":    htmlBody,
	})
}

// validateTemplateTestInput menormalisasi body request kirim tes
// template: alamat tujuan wajib email valid; subjek/isi (bila
// diberikan) dibatasi panjang yang sama dengan simpan template.
// Subjek/isi kosong berarti "pakai template tersimpan" — jadi keduanya
// boleh kosong, tapi tidak boleh sebelah saja melebihi batas.
// Mengembalikan (to, subject, body, pesanError) — pesanError kosong
// berarti valid.
func validateTemplateTestInput(to, subject, body string) (string, string, string, string) {
	to = strings.TrimSpace(to)
	if !validEmail(to) {
		return "", "", "", "alamat email tujuan tidak valid"
	}
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)
	if len(subject) > 255 || len(body) > 20000 {
		return "", "", "", "subjek maks 255 karakter, isi maks 20000 karakter"
	}
	return to, subject, body, ""
}

// handleAdminTestEmailTemplate mengirim email tes untuk satu template
// ke alamat yang diminta admin (v39b). Bila subject + body_html
// diberikan (isi editor saat itu, belum tentu tersimpan), keduanya
// dirender dengan data contoh yang sama seperti preview; bila tidak
// diberikan, template tersimpan yang dirender. Subjek diawali "[Tes] "
// supaya jelas ini email tes. Pengiriman dicatat ke email_logs
// (kind "template_test", refID = key template).
func (s *Server) handleAdminTestEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	key := r.PathValue("key")
	if _, ok := defaultEmailTemplate(key); !ok {
		writeErr(w, http.StatusNotFound, "not_found", "template email tidak ditemukan")
		return
	}
	var req struct {
		To       string `json:"to"`
		Subject  string `json:"subject"`
		BodyHTML string `json:"body_html"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	to, subj, body, msg := validateTemplateTestInput(req.To, req.Subject, req.BodyHTML)
	if msg != "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", msg)
		return
	}
	vars := s.sampleTemplateVars(key)
	var subject, text, htmlBody string
	if subj != "" && body != "" {
		subject, text, htmlBody = renderTemplateContent(subj, body, vars)
	} else {
		subject, text, htmlBody = s.renderEmailTemplate(r.Context(), key, vars)
	}
	if err := s.sendMail(r.Context(), nil, "template_test", key, to, "[Tes] "+subject, text, htmlBody); err != nil {
		if errors.Is(err, mail.ErrNotConfigured) {
			writeErr(w, http.StatusBadRequest, "smtp_not_configured", "SMTP belum dikonfigurasi atau belum diaktifkan — isi pengaturan SMTP lalu coba lagi")
			return
		}
		if errors.Is(err, mail.ErrAPIKeyNotConfigured) {
			writeErr(w, http.StatusBadRequest, "mailketing_api_key_not_configured", "API key Mailketing belum diisi atau alamat pengirim belum diatur — isi pengaturan Mailketing lalu coba lagi")
			return
		}
		writeErr(w, http.StatusBadGateway, "mail_error", "gagal mengirim email tes: "+friendlyMailError(err))
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "email_template_test", "tes template "+key+" ke "+to)
	writeJSON(w, http.StatusOK, map[string]any{"message": "email tes terkirim", "to": to, "key": key})
}

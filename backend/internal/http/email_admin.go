package http

import (
	"database/sql"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"mutasi-hub/internal/mail"
)

// --- email tes (admin) ---

// handleAdminTestEmail mengirim satu email tes ke alamat email admin
// yang sedang login, lewat provider yang aktif. Bila provider belum
// dikonfigurasi, gagal bersih 400 — tidak pernah mengarang keberhasilan.
func (s *Server) handleAdminTestEmail(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	admin, _ := adminID(r)
	var to string
	if err := s.store.DB.QueryRowContext(r.Context(),
		`SELECT email FROM admin_users WHERE id=?`, admin).Scan(&to); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca email admin")
		return
	}
	subject := "Email tes MutasiHub — pengiriman email berfungsi"
	inner := `<p>Halo,</p><p>Ini email tes dari MutasiHub. Bila Anda menerima email ini, pengaturan email sudah benar.</p>`
	textBody := "Halo,\n\nIni email tes dari MutasiHub. Bila Anda menerima email ini, pengaturan email sudah benar."
	text, htmlBody := emailShell(inner, textBody)
	if err := s.sendMail(r.Context(), nil, "test", "", to, subject, text, htmlBody); err != nil {
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
	s.audit(r, "admin", admin, "email_test", "email tes terkirim ke "+to)
	writeJSON(w, http.StatusOK, map[string]any{"message": "email tes terkirim", "to": to})
}

// friendlyMailError memendekkan error pengiriman untuk panel admin
// (tanpa alamat server mentah yang panjang).
func friendlyMailError(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, ": "); i >= 0 {
		return msg[i+2:]
	}
	return msg
}

// --- pengumuman admin ("berita" ke semua member aktif) ---

type announcementRow struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Body        string  `json:"body"`
	Status      string  `json:"status"`
	SentCount   int     `json:"sent_count"`
	FailedCount int     `json:"failed_count"`
	CreatedAt   string  `json:"created_at"`
	SentAt      *string `json:"sent_at"`
}

func (s *Server) handleAdminListAnnouncements(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, title, body, status,
		sent_count, failed_count, created_at, sent_at FROM admin_announcements ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca pengumuman")
		return
	}
	defer rows.Close()
	out := []announcementRow{}
	for rows.Next() {
		var a announcementRow
		var created time.Time
		var sent sql.NullTime
		if err := rows.Scan(&a.ID, &a.Title, &a.Body, &a.Status, &a.SentCount, &a.FailedCount, &created, &sent); err != nil {
			continue
		}
		a.CreatedAt = formatWIB(created)
		if sent.Valid {
			v := formatWIB(sent.Time)
			a.SentAt = &v
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcements": out})
}

func (s *Server) handleAdminCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "judul dan isi pengumuman wajib diisi")
		return
	}
	if len(req.Title) > 255 || len(req.Body) > 10000 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "judul maks 255 karakter, isi maks 10000 karakter")
		return
	}
	id := newID()
	admin, _ := adminID(r)
	if _, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO admin_announcements
		(id, title, body, created_by, status) VALUES (?, ?, ?, ?, 'draft')`, id, req.Title, req.Body, admin); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan pengumuman")
		return
	}
	s.audit(r, "admin", admin, "announcement_create", "pengumuman dibuat: "+req.Title)
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "draft", "message": "pengumuman disimpan sebagai draf"})
}

// handleAdminSendAnnouncement mengirim pengumuman draf ke SEMUA member
// aktif. Hanya draf yang bisa dikirim (pengiriman ulang dicegah oleh
// status). Bila provider belum dikonfigurasi, gagal 400 tanpa mengubah
// status — admin bisa mengirim lagi setelah provider diisi.
func (s *Server) handleAdminSendAnnouncement(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	var title, body, status string
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT title, body, status
		FROM admin_announcements WHERE id=?`, id).Scan(&title, &body, &status); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "pengumuman tidak ditemukan")
		return
	}
	if status != "draft" {
		writeErr(w, http.StatusConflict, "already_sent", "pengumuman ini sudah dikirim dan tidak bisa dikirim ulang")
		return
	}
	if _, err := s.mailSender(r.Context()); err != nil {
		if errors.Is(err, mail.ErrNotConfigured) {
			writeErr(w, http.StatusBadRequest, "smtp_not_configured", "SMTP belum dikonfigurasi atau belum diaktifkan — isi pengaturan SMTP lalu coba lagi")
			return
		}
		if errors.Is(err, mail.ErrAPIKeyNotConfigured) {
			writeErr(w, http.StatusBadRequest, "mailketing_api_key_not_configured", "API key Mailketing belum diisi atau alamat pengirim belum diatur — isi pengaturan Mailketing lalu coba lagi")
			return
		}
		writeErr(w, http.StatusBadGateway, "mail_error", "konfigurasi pengiriman tidak valid: "+friendlyMailError(err))
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, email FROM members
		WHERE COALESCE(status,'active')='active' ORDER BY created_at ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca daftar member")
		return
	}
	defer rows.Close()
	type recipient struct{ id, email string }
	var rcpts []recipient
	for rows.Next() {
		var rc recipient
		if err := rows.Scan(&rc.id, &rc.email); err == nil {
			rcpts = append(rcpts, rc)
		}
	}
	rows.Close()
	inner := `<p>Halo,</p>` + announcementHTML(body) +
		`<p>Salam,<br>Tim MutasiHub</p>`
	textBody := "Halo,\n\n" + body + "\n\nSalam,\nTim MutasiHub"
	sent, failed := 0, 0
	for _, rc := range rcpts {
		text, htmlBody := emailShell(inner, textBody)
		mid := rc.id
		if err := s.sendMail(r.Context(), &mid, "announcement", id, rc.email, title, text, htmlBody); err != nil {
			failed++
		} else {
			sent++
		}
	}
	admin, _ := adminID(r)
	_, _ = s.store.DB.ExecContext(r.Context(), `UPDATE admin_announcements
		SET status='sent', sent_count=?, failed_count=?, sent_at=NOW() WHERE id=?`, sent, failed, id)
	s.audit(r, "admin", admin, "announcement_send",
		fmt.Sprintf("pengumuman %s dikirim: %d berhasil, %d gagal", id, sent, failed))
	writeJSON(w, http.StatusOK, map[string]any{
		"message":      fmt.Sprintf("pengumuman dikirim ke %d member (%d gagal)", sent, failed),
		"sent_count":   sent,
		"failed_count": failed,
	})
}

// announcementHTML mengubah isi pengumuman (teks polos admin) menjadi
// HTML aman: escape dulu, lalu baris baru jadi <br>.
func announcementHTML(body string) string {
	esc := html.EscapeString(strings.TrimSpace(body))
	return "<p>" + strings.ReplaceAll(esc, "\n", "<br>") + "</p>"
}

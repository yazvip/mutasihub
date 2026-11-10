// Email member (v37 SMTP, v38 + Mailketing API, v39 template custom
// admin): provider pengiriman dipilih admin lewat settings
// (mail_provider: "smtp" | "mailketing_api"), isi email diambil dari
// tabel email_templates (bisa diubah admin, fallback ke default di
// email_templates.go) — email transaksional (verifikasi + reset
// password), email tagihan (pending/paid/kedaluwarsa), pengingat
// H-3/H-1, dan pengumuman admin.
//
// Semua pengiriman dicatat di email_logs (sent/failed + error).
// Pengiriman TIDAK PERNAH menggagalkan alur utama (register, order,
// callback): gagal kirim hanya di-log — fail-open. Satu-satunya jalur
// yang mengembalikan error ke pemanggil adalah endpoint tes dan kirim
// pengumuman (admin memang meminta pengiriman itu eksplisit).
package http

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"mutasi-hub/internal/crypto"
	"mutasi-hub/internal/mail"
)

// --- konfigurasi & pengiriman dasar ---

// mailSender memuat provider email yang aktif dari tabel settings
// (v38: SMTP atau Mailketing API).
func (s *Server) mailSender(ctx context.Context) (mail.Sender, error) {
	return mail.LoadSender(ctx, s.store, s.encKey, crypto.Decrypt)
}

// logEmail mencatat satu percobaan pengiriman. Best-effort: kegagalan
// pencatatan tidak boleh menggagalkan pengiriman itu sendiri.
func (s *Server) logEmail(ctx context.Context, memberID *string, kind, refID, subject, to, status, errMsg string) {
	if !s.store.Available() {
		return
	}
	var mid sql.NullString
	if memberID != nil {
		mid = sql.NullString{String: *memberID, Valid: true}
	}
	var ref sql.NullString
	if refID != "" {
		ref = sql.NullString{String: refID, Valid: true}
	}
	var em sql.NullString
	if errMsg != "" {
		em = sql.NullString{String: errMsg, Valid: true}
	}
	if _, err := s.store.DB.ExecContext(ctx, `INSERT INTO email_logs
		(id, member_id, kind, ref_id, subject, to_email, status, error)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		newID(), mid, kind, ref, subject, to, status, em); err != nil {
		s.log.Printf("http: email: log gagal kind=%s to=%s: %v", kind, to, err)
	}
}

// sendMail mengirim satu email lewat provider aktif dan mencatat
// hasilnya. Bila provider belum dikonfigurasi, kembalikan
// mail.ErrNotConfigured / mail.ErrAPIKeyNotConfigured TANPA mencatat
// baris log (menghindari spam baris gagal di job pengingat tiap
// 30 menit).
func (s *Server) sendMail(ctx context.Context, memberID *string, kind, refID, to, subject, textBody, htmlBody string) error {
	sender, err := s.mailSender(ctx)
	if err != nil {
		if errors.Is(err, mail.ErrNotConfigured) || errors.Is(err, mail.ErrAPIKeyNotConfigured) {
			s.log.Printf("http: email: pengiriman belum dikonfigurasi, email %s ke %s tidak dikirim", kind, to)
			return err
		}
		s.log.Printf("http: email: muat konfigurasi pengiriman gagal: %v", err)
		s.logEmail(ctx, memberID, kind, refID, subject, to, "failed", err.Error())
		return err
	}
	if err := sender.Send(ctx, to, subject, textBody, htmlBody); err != nil {
		s.log.Printf("http: email: kirim %s ke %s gagal: %v", kind, to, err)
		s.logEmail(ctx, memberID, kind, refID, subject, to, "failed", err.Error())
		return err
	}
	s.logEmail(ctx, memberID, kind, refID, subject, to, "sent", "")
	return nil
}

// alreadySentEmail dipakai sebagai anti-duplikat pengingat: true bila
// sudah ada baris 'sent' untuk (kind, ref_id) yang sama.
func (s *Server) alreadySentEmail(ctx context.Context, kind, refID string) bool {
	if !s.store.Available() || refID == "" {
		return false
	}
	var n int
	if err := s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM email_logs
		WHERE kind=? AND ref_id=? AND status='sent'`, kind, refID).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

// formatRupiah mengubah price_cents (sen) menjadi "Rp350.000".
func formatRupiah(cents int64) string {
	rp := cents / 100
	neg := rp < 0
	if neg {
		rp = -rp
	}
	digits := fmt.Sprintf("%d", rp)
	var parts []string
	for len(digits) > 3 {
		parts = append([]string{digits[len(digits)-3:]}, parts...)
		digits = digits[:len(digits)-3]
	}
	parts = append([]string{digits}, parts...)
	out := "Rp" + strings.Join(parts, ".")
	if neg {
		return "-" + out
	}
	return out
}

// --- template email (teks + HTML, brand MutasiHub) ---

// emailShell membungkus isi HTML dengan header/footer brand dan
// mengembalikan pasangan (teks, HTML). Isi tiap jenis email berasal
// dari tabel email_templates (renderEmailTemplate); teks polos
// diturunkan otomatis dari HTML (htmlToText) agar satu sumber
// kebenaran — tautan tombol dipertahankan sebagai "label (url)".
func emailShell(innerHTML, textBody string) (string, string) {
	htmlBody := `<!DOCTYPE html><html lang="id"><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
<h2 style="color:#047857;margin:0 0 16px">MutasiHub</h2>` + innerHTML + `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">
<p style="font-size:12px;color:#64748b">Email ini dikirim otomatis oleh MutasiHub. Jangan balas email ini.</p>
</body></html>`
	return strings.TrimSpace(textBody), htmlBody
}

func (s *Server) frontendURL() string {
	base := strings.TrimRight(s.cfg.FrontendURL, "/")
	if base == "" {
		base = "https://mutasi.rajacek.com"
	}
	return base
}

// sendVerificationEmail mengirim tautan verifikasi setelah register.
// Fail-open: provider belum dikonfigurasi / gagal kirim tidak
// menggagalkan register — token tetap tersimpan dan bisa dikirim
// ulang nanti.
func (s *Server) sendVerificationEmail(ctx context.Context, memberID, email, token string) {
	link := s.frontendURL() + "/verify-email?token=" + url.QueryEscape(token)
	subject, text, htmlBody := s.renderEmailTemplate(ctx, "email_verification", map[string]string{
		"nama":   s.memberDisplayName(ctx, memberID, email),
		"tautan": link,
	})
	_ = s.sendMail(ctx, &memberID, "email_verification", memberID, email, subject, text, htmlBody)
}

// sendResetEmail mengirim tautan reset password (berlaku 1 jam).
func (s *Server) sendResetEmail(ctx context.Context, memberID, email, token string) {
	link := s.frontendURL() + "/reset-password?token=" + url.QueryEscape(token)
	subject, text, htmlBody := s.renderEmailTemplate(ctx, "password_reset", map[string]string{
		"nama":   s.memberDisplayName(ctx, memberID, email),
		"tautan": link,
	})
	_ = s.sendMail(ctx, &memberID, "password_reset", memberID, email, subject, text, htmlBody)
}

// sendOrderPendingEmail: tagihan baru dibuat, menunggu pembayaran.
func (s *Server) sendOrderPendingEmail(ctx context.Context, memberID, email, planName, orderID string, amountCents int64) {
	subject, text, htmlBody := s.renderEmailTemplate(ctx, "order_pending", map[string]string{
		"nama":     s.memberDisplayName(ctx, memberID, email),
		"paket":    planName,
		"jumlah":   formatRupiah(amountCents),
		"order_id": orderID,
		"tautan":   s.frontendURL() + "/member/subscription",
	})
	_ = s.sendMail(ctx, &memberID, "order_pending", orderID, email, subject, text, htmlBody)
}

// sendOrderPaidEmail: pembayaran berhasil, paket aktif.
func (s *Server) sendOrderPaidEmail(ctx context.Context, memberID, email, planName, orderID string, expiresAt time.Time) {
	subject, text, htmlBody := s.renderEmailTemplate(ctx, "order_paid", map[string]string{
		"nama":           s.memberDisplayName(ctx, memberID, email),
		"paket":          planName,
		"berlaku_sampai": formatWIB(expiresAt),
	})
	_ = s.sendMail(ctx, &memberID, "order_paid", orderID, email, subject, text, htmlBody)
}

// --- job pengingat kedaluwarsa (H-3 / H-1 / kedaluwarsa) ---

// EmailReminderLoop jalan tiap 30 menit (ticker sendiri, terpisah dari
// sync mutasi 1 menit). Satu pass pertama langsung jalan saat start —
// anti-duplikat via email_logs membuat pengiriman ulang mustahil.
func (s *Server) EmailReminderLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	s.sendExpiryReminders(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sendExpiryReminders(ctx)
		}
	}
}

func (s *Server) sendExpiryReminders(ctx context.Context) {
	if !s.store.Available() {
		return
	}
	// Provider belum dikonfigurasi = tidak ada yang bisa dikirim; cukup
	// sekali log, jangan spam baris gagal per member.
	if _, err := s.mailSender(ctx); err != nil {
		return
	}
	rows, err := s.store.DB.QueryContext(ctx, `SELECT sub.id, sub.member_id, m.email, p.name, sub.expires_at
		FROM subscriptions sub
		JOIN members m ON m.id=sub.member_id
		JOIN plans p ON p.id=sub.plan_id
		WHERE sub.status='active' AND COALESCE(m.status,'active')='active' AND sub.expires_at IS NOT NULL`)
	if err != nil {
		s.log.Printf("http: email: scan pengingat gagal: %v", err)
		return
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var subID, memberID, email, planName string
		var expiresAt time.Time
		if err := rows.Scan(&subID, &memberID, &email, &planName, &expiresAt); err != nil {
			continue
		}
		kind := ""
		vars := map[string]string{
			"nama":           s.memberDisplayName(ctx, memberID, email),
			"paket":          planName,
			"berlaku_sampai": formatWIB(expiresAt),
		}
		switch {
		case expiresAt.Before(now):
			kind = "subscription_expired"
		case expiresAt.Before(now.Add(24 * time.Hour)):
			kind = "expiry_reminder_h1"
			vars["sisa_hari"] = "1"
		case expiresAt.Before(now.Add(72 * time.Hour)):
			kind = "expiry_reminder_h3"
			vars["sisa_hari"] = "3"
		default:
			continue
		}
		if s.alreadySentEmail(ctx, kind, subID) {
			continue
		}
		subject, text, htmlBody := s.renderEmailTemplate(ctx, kind, vars)
		_ = s.sendMail(ctx, &memberID, kind, subID, email, subject, text, htmlBody)
	}
}

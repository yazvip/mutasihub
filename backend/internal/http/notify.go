// Notifikasi mutasi email per interval paket (v42b).
//
// Tiap member dengan langganan aktif menerima ringkasan (digest) email
// bila ada mutasi baru sejak watermark terakhir DAN interval paketnya
// sudah lewat. Aturan inti (Q1–Q5 plan v42):
//   - Kanal hanya email (Telegram = fase terpisah, bukan v42b).
//   - Default ON (notif_enabled=1); member bisa opt-out lewat toggle.
//   - Cap 200 digest/hari/member (pengaman biaya Mailketing).
//   - Isi ringkasan: jumlah + total masuk/keluar + tautan dashboard,
//     bukan rincian per transaksi.
//   - Digest otomatis HANYA untuk email terverifikasi
//     (members.email_verified_at NOT NULL); tombol tes kirim ke email
//     member atas permintaan eksplisitnya sendiri.
//   - Watermark = mutations.id (auto-increment; dedup menjamin tiap
//     baris unik). Watermark maju HANYA bila kirim sukses; gagal kirim
//     hanya memajukan last_notified_at (throttle retry ke interval
//     berikut, tidak ada mutasi yang hilang, tidak ada spam retry).
//   - Fail-open penuh: error worker tidak pernah mengganggu syncer
//     (loop terpisah; sendMail sudah fail-open). Bila provider mail
//     belum dikonfigurasi, loop diam (pola sendExpiryReminders).
package http

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// mutationNotifyCapPerDay: pengaman biaya — maks digest per member per
// hari (Q3). Enterprise 1 menit tanpa cap bisa mencapai 1.440/hari.
const mutationNotifyCapPerDay = 200

// notificationTestThrottleWindow: tombol tes dibatasi 1/menit/member.
const notificationTestThrottleWindow = time.Minute

// notifyShouldSend memutuskan apakah digest boleh dikirim pada pass ini
// (pure, unit-testable): tanpa mutasi baru = tidak kirim; interval
// belum lewat sejak kirim terakhir = tidak kirim; cap harian tercapai
// = tidak kirim. lastNotifiedAt kosong (belum pernah kirim) = interval
// dianggap sudah lewat.
func notifyShouldSend(newCount int64, lastNotifiedAt time.Time, hasLast bool, intervalMin, sentToday, capPerDay int, now time.Time) bool {
	if newCount <= 0 {
		return false
	}
	if intervalMin < 1 {
		intervalMin = 1
	}
	if hasLast && now.Sub(lastNotifiedAt) < time.Duration(intervalMin)*time.Minute {
		return false
	}
	if capPerDay > 0 && sentToday >= capPerDay {
		return false
	}
	return true
}

// notifyAdvanceWatermark mengembalikan watermark baru setelah satu
// percobaan kirim (pure): sukses = maju ke mutasi terbaru; gagal =
// tetap (tidak ada mutasi yang hilang, retry di interval berikut).
func notifyAdvanceWatermark(success bool, maxID, prevWatermark int64) int64 {
	if success {
		return maxID
	}
	return prevWatermark
}

// MutationNotifyLoop jalan tiap 1 menit (ticker sendiri, terpisah dari
// sync mutasi 1 menit dan pengingat kedaluwarsa 30 menit). Satu pass
// pertama langsung jalan saat start. Berhenti saat ctx dibatalkan.
func (s *Server) MutationNotifyLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	s.sendMutationDigests(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sendMutationDigests(ctx)
		}
	}
}

// notifyCandidate: satu member yang layak dipertimbangkan untuk digest
// pada pass ini (langganan aktif + notif ON + email terverifikasi).
type notifyCandidate struct {
	memberID       string
	email          string
	intervalMin    int
	lastNotifiedAt sql.NullTime
	lastMutationID int64
	sentToday      int
}

func (s *Server) sendMutationDigests(ctx context.Context) {
	if !s.store.Available() {
		return
	}
	// Provider belum dikonfigurasi = tidak ada yang bisa dikirim; diam.
	if _, err := s.mailSender(ctx); err != nil {
		return
	}
	// Langganan aktif terbaru per member (ORDER BY expires_at DESC +
	// dedup di Go — pola yang sama dengan handleProfile).
	rows, err := s.store.DB.QueryContext(ctx, `SELECT m.id, m.email, p.notif_interval_minutes,
			mns.last_notified_at, COALESCE(mns.last_mutation_id, 0),
			IF(mns.sent_day = CURDATE(), mns.sent_today, 0)
		FROM members m
		JOIN subscriptions sub ON sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW()
		JOIN plans p ON p.id=sub.plan_id
		LEFT JOIN mutation_notify_state mns ON mns.member_id=m.id
		WHERE COALESCE(m.status,'active')='active'
			AND COALESCE(m.notif_enabled,1)=1
			AND m.email_verified_at IS NOT NULL
		ORDER BY sub.expires_at DESC`)
	if err != nil {
		s.log.Printf("http: notify: scan kandidat gagal: %v", err)
		return
	}
	defer rows.Close()
	seen := map[string]bool{}
	now := time.Now()
	for rows.Next() {
		var c notifyCandidate
		if err := rows.Scan(&c.memberID, &c.email, &c.intervalMin, &c.lastNotifiedAt, &c.lastMutationID, &c.sentToday); err != nil {
			continue
		}
		if seen[c.memberID] {
			continue
		}
		seen[c.memberID] = true
		s.notifyMemberDigest(ctx, c, now)
	}
}

func (s *Server) notifyMemberDigest(ctx context.Context, c notifyCandidate, now time.Time) {
	var count, inCents, outCents, maxID int64
	if err := s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN type='CR' THEN amount_cents ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN type='DB' THEN amount_cents ELSE 0 END), 0),
			COALESCE(MAX(id), 0)
		FROM mutations WHERE member_id=? AND id > ?`,
		c.memberID, c.lastMutationID).Scan(&count, &inCents, &outCents, &maxID); err != nil {
		s.log.Printf("http: notify: hitung mutasi member=%s gagal: %v", c.memberID, err)
		return
	}
	if !notifyShouldSend(count, c.lastNotifiedAt.Time, c.lastNotifiedAt.Valid, c.intervalMin, c.sentToday, mutationNotifyCapPerDay, now) {
		return
	}
	vars := map[string]string{
		"nama":   s.memberDisplayName(ctx, c.memberID, c.email),
		"jumlah": strconv.FormatInt(count, 10),
		"masuk":  formatRupiah(inCents),
		"keluar": formatRupiah(outCents),
		"tautan": s.frontendURL() + "/member/dashboard",
	}
	subject, text, htmlBody := s.renderEmailTemplate(ctx, "mutation_digest", vars)
	// ref_id unik per batch (member:maxID) — anti-duplikat ganda dengan
	// watermark.
	refID := fmt.Sprintf("%s:%d", c.memberID, maxID)
	err := s.sendMail(ctx, &c.memberID, "mutation_digest", refID, c.email, subject, text, htmlBody)
	s.advanceNotifyState(ctx, c.memberID, err == nil, maxID, c.lastMutationID)
}

// advanceNotifyState memajukan status pengiriman setelah satu percobaan
// kirim: last_notified_at SELALU maju ke sekarang (throttle retry ke
// interval berikut); watermark + hitungan harian hanya maju bila kirim
// sukses. sent_day mengikuti CURDATE() agar hitungan harian reset saat
// hari berganti (konsisten dengan pembacaan IF(sent_day=CURDATE())).
func (s *Server) advanceNotifyState(ctx context.Context, memberID string, success bool, maxID, prevWatermark int64) {
	newWatermark := notifyAdvanceWatermark(success, maxID, prevWatermark)
	if success {
		if _, err := s.store.DB.ExecContext(ctx, `INSERT INTO mutation_notify_state
				(member_id, last_notified_at, last_mutation_id, sent_today, sent_day)
			VALUES (?, NOW(), ?, 1, CURDATE())
			ON DUPLICATE KEY UPDATE last_notified_at=NOW(), last_mutation_id=VALUES(last_mutation_id),
				sent_today=IF(sent_day=CURDATE(), sent_today+1, 1), sent_day=CURDATE()`,
			memberID, newWatermark); err != nil {
			s.log.Printf("http: notify: simpan state member=%s gagal: %v", memberID, err)
		}
		return
	}
	if _, err := s.store.DB.ExecContext(ctx, `INSERT INTO mutation_notify_state
			(member_id, last_notified_at, last_mutation_id, sent_today, sent_day)
		VALUES (?, NOW(), ?, 0, CURDATE())
		ON DUPLICATE KEY UPDATE last_notified_at=NOW(),
			sent_today=IF(sent_day=CURDATE(), sent_today, 0), sent_day=CURDATE()`,
		memberID, newWatermark); err != nil {
		s.log.Printf("http: notify: simpan state member=%s gagal: %v", memberID, err)
	}
}

// --- endpoint member ---

// handleGetMemberNotifications mengembalikan preferensi notifikasi
// member + interval paket aktif + terakhir dikirim.
// Resp 200 {notif_enabled, notif_channel, interval_minutes,
// last_notified_at (WIB RFC3339 atau "")}.
func (s *Server) handleGetMemberNotifications(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var enabled int
	var channel string
	var interval int
	var last sql.NullTime
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(m.notif_enabled,1), COALESCE(m.notif_channel,'email'),
			COALESCE(p.notif_interval_minutes,0), mns.last_notified_at
		FROM members m
		LEFT JOIN subscriptions sub ON sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW()
		LEFT JOIN plans p ON p.id=sub.plan_id
		LEFT JOIN mutation_notify_state mns ON mns.member_id=m.id
		WHERE m.id=? ORDER BY sub.expires_at DESC LIMIT 1`, id).
		Scan(&enabled, &channel, &interval, &last)
	if err != nil {
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusNotFound, "not_found", "member tidak ditemukan")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca preferensi notifikasi")
		return
	}
	lastStr := ""
	if last.Valid {
		lastStr = formatWIB(last.Time)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notif_enabled":    enabled == 1,
		"notif_channel":    channel,
		"interval_minutes": interval,
		"last_notified_at": lastStr,
	})
}

// handleUpdateMemberNotifications mengubah preferensi notifikasi member.
// Hanya kanal "email" yang berlaku saat ini (nilai lain → 400);
// notif_enabled=false mematikan digest otomatis (opt-out, Q2).
// Resp 200 {notif_enabled, notif_channel, message}.
func (s *Server) handleUpdateMemberNotifications(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var req struct {
		Enabled *bool   `json:"notif_enabled"`
		Channel *string `json:"notif_channel"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Enabled == nil && req.Channel == nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "tidak ada preferensi yang diubah")
		return
	}
	if req.Channel != nil && *req.Channel != "email" {
		writeErr(w, http.StatusBadRequest, "invalid_notif_channel", "kanal notifikasi saat ini hanya email")
		return
	}
	if req.Enabled != nil {
		enabled := 0
		if *req.Enabled {
			enabled = 1
		}
		if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET notif_enabled=? WHERE id=?`, enabled, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan preferensi notifikasi")
			return
		}
	}
	if req.Channel != nil {
		if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET notif_channel=? WHERE id=?`, *req.Channel, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan preferensi notifikasi")
			return
		}
	}
	s.audit(r, "member", id, "notification_prefs_updated", "preferensi notifikasi diubah member")
	var enabled int
	var channel string
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COALESCE(notif_enabled,1), COALESCE(notif_channel,'email') FROM members WHERE id=?`, id).Scan(&enabled, &channel); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca preferensi notifikasi")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notif_enabled": enabled == 1,
		"notif_channel": channel,
		"message":       "Preferensi notifikasi disimpan",
	})
}

// handleTestMemberNotification mengirim satu digest CONTOH (angka contoh,
// bukan data nyata) ke email member — untuk memastikan pengiriman jalan.
// Throttle 1/menit/member (via email_logs kind=notification_test) → 429.
// Resp 200 {message} / 502 bila provider gagal.
func (s *Server) handleTestMemberNotification(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id, _ := memberID(r)
	var last sql.NullTime
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT MAX(created_at) FROM email_logs
		WHERE kind='notification_test' AND member_id=?`, id).Scan(&last)
	if last.Valid && time.Since(last.Time) < notificationTestThrottleWindow {
		writeErr(w, http.StatusTooManyRequests, "notification_test_throttled", "tunggu sebentar sebelum mengirim notifikasi tes lagi (maks 1 per menit)")
		return
	}
	var email string
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT email FROM members WHERE id=?`, id).Scan(&email); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "member tidak ditemukan")
		return
	}
	vars := map[string]string{
		"nama":   s.memberDisplayName(r.Context(), id, email),
		"jumlah": "3",
		"masuk":  formatRupiah(15000000),
		"keluar": formatRupiah(5000000),
		"tautan": s.frontendURL() + "/member/dashboard",
	}
	subject, text, htmlBody := s.renderEmailTemplate(r.Context(), "mutation_digest", vars)
	refID := fmt.Sprintf("%s:%d", id, time.Now().Unix())
	if err := s.sendMail(r.Context(), &id, "notification_test", refID, email, subject, text, htmlBody); err != nil {
		writeErr(w, http.StatusBadGateway, "notification_test_failed", "gagal mengirim notifikasi tes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "Notifikasi tes dikirim ke email Anda"})
}

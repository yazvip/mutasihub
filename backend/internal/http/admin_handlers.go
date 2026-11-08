package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"mutasi-hub/internal/auth"
	"mutasi-hub/internal/crypto"
	"mutasi-hub/internal/domain"
)

func (s *Server) handleAdminListPlans(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, slug, name, price_cents, duration_days,
		max_accounts, api_delay_minutes, notif_interval_minutes, max_devices, callback_enabled, inquiry_enabled, inquiry_limit, is_active
		FROM plans ORDER BY price_cents`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca paket")
		return
	}
	defer rows.Close()
	plans := []domain.Plan{}
	for rows.Next() {
		var p domain.Plan
		var cb, inq, active int
		var limit sql.NullInt32
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.PriceCents, &p.DurationDays, &p.MaxAccounts,
			&p.APIDelayMinutes, &p.NotifIntervalMin, &p.MaxDevices, &cb, &inq, &limit, &active); err != nil {
			continue
		}
		p.CallbackEnabled = cb == 1
		p.InquiryEnabled = inq == 1
		p.InquiryLimit = nullInt32ToPtr(limit)
		p.IsActive = active == 1
		plans = append(plans, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": plans})
}

func (s *Server) handleAdminCreatePlan(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var p domain.Plan
	if !readJSON(w, r, &p) {
		return
	}
	p.IsActive = true
	if err := domain.ValidatePlan(p); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_plan", err.Error())
		return
	}
	res, err := s.store.DB.ExecContext(r.Context(), `INSERT INTO plans
		(slug, name, price_cents, duration_days, max_accounts, api_delay_minutes,
		 notif_interval_minutes, max_devices, callback_enabled, inquiry_enabled, inquiry_limit, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		p.Slug, p.Name, p.PriceCents, p.DurationDays, p.MaxAccounts, p.APIDelayMinutes,
		p.NotifIntervalMin, p.MaxDevices, boolToInt(p.CallbackEnabled), boolToInt(p.InquiryEnabled), intPtrToDB(p.InquiryLimit))
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") {
			writeErr(w, http.StatusConflict, "slug_taken", "slug paket sudah dipakai")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membuat paket")
		return
	}
	id, _ := res.LastInsertId()
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "plan_create", "slug "+p.Slug)
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "slug": p.Slug})
}

// nullableIntField membedakan tiga keadaan sebuah field integer di
// request partial-update (PUT plan):
//   - tidak dikirim: Present=false (field tidak diubah);
//   - null eksplisit: Present=true, Value=nil (hapus batas -> tanpa batas);
//   - angka: Present=true, Value=&n.
//
// encoding/json TIDAK bisa membedakan null dari tidak dikirim untuk
// *int — null selalu menjadi pointer nil — dan untuk **int pun null
// juga menjadi pointer nil (terbukti lewat probe: {"inquiry_limit":null}
// decode ke **int menghasilkan nil, sama seperti {}). Karena itu perlu
// UnmarshalJSON kustom dengan flag Present. Tanpa ini, admin yang
// mengosongkan batas di panel akan mengira limit sudah "Tanpa batas"
// padahal limit lama diam-diam bertahan.
type nullableIntField struct {
	Present bool
	Value   *int
}

// UnmarshalJSON mencatat kehadiran field; "null" -> Value nil,
// angka -> Value menunjuk nilainya. Nilai bukan integer valid
// (string, float) mengembalikan error decode -> 400 invalid_json.
func (f *nullableIntField) UnmarshalJSON(data []byte) error {
	f.Present = true
	if strings.TrimSpace(string(data)) == "null" {
		f.Value = nil
		return nil
	}
	var v int
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	f.Value = &v
	return nil
}

// planUpdateRequest adalah body PUT /api/v1/admin/plans/{id}.
// Field pointer = "tidak dikirim berarti tidak diubah", kecuali
// inquiry_limit yang memakai nullableIntField (lihat di atas).
type planUpdateRequest struct {
	Slug             *string          `json:"slug"`
	Name             *string          `json:"name"`
	PriceCents       *int64           `json:"price_cents"`
	DurationDays     *int             `json:"duration_days"`
	MaxAccounts      *int             `json:"max_accounts"`
	APIDelayMinutes  *int             `json:"api_delay_minutes"`
	NotifIntervalMin *int             `json:"notif_interval_minutes"`
	MaxDevices       *int             `json:"max_devices"`
	CallbackEnabled  *bool            `json:"callback_enabled"`
	InquiryEnabled   *bool            `json:"inquiry_enabled"`
	InquiryLimit     nullableIntField `json:"inquiry_limit"`
	IsActive         *bool            `json:"is_active"`
}

// applyPlanUpdateRequest menerapkan field request yang dikirim ke plan
// saat ini (pure, tanpa DB — unit-testable). inquiry_limit null
// eksplisit menghapus batas (Value nil -> InquiryLimit nil); field
// tidak dikirim (Present=false) membiarkan nilai lama.
func applyPlanUpdateRequest(cur domain.Plan, req planUpdateRequest) domain.Plan {
	if req.Slug != nil {
		cur.Slug = *req.Slug
	}
	if req.Name != nil {
		cur.Name = *req.Name
	}
	if req.PriceCents != nil {
		cur.PriceCents = *req.PriceCents
	}
	if req.DurationDays != nil {
		cur.DurationDays = *req.DurationDays
	}
	if req.MaxAccounts != nil {
		cur.MaxAccounts = *req.MaxAccounts
	}
	if req.APIDelayMinutes != nil {
		cur.APIDelayMinutes = *req.APIDelayMinutes
	}
	if req.NotifIntervalMin != nil {
		cur.NotifIntervalMin = *req.NotifIntervalMin
	}
	if req.MaxDevices != nil {
		cur.MaxDevices = *req.MaxDevices
	}
	if req.CallbackEnabled != nil {
		cur.CallbackEnabled = *req.CallbackEnabled
	}
	if req.InquiryEnabled != nil {
		cur.InquiryEnabled = *req.InquiryEnabled
	}
	if req.InquiryLimit.Present {
		cur.InquiryLimit = req.InquiryLimit.Value
	}
	if req.IsActive != nil {
		cur.IsActive = *req.IsActive
	}
	return cur
}

func (s *Server) handleAdminUpdatePlan(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	// Pointer fields distinguish "not sent" from an explicit zero/false,
	// so a partial PUT never overwrites fields the admin did not send.
	// inquiry_limit memakai nullableIntField (bukan *int/**int): JSON
	// null harus dibedakan dari field tidak dikirim — encoding/json
	// mengubah null menjadi pointer nil, jadi *int/**int TIDAK bisa
	// membedakan keduanya dan null eksplisit akan diam-diam
	// mempertahankan limit lama.
	var req planUpdateRequest
	if !readJSON(w, r, &req) {
		return
	}
	idStr := r.PathValue("id")
	planID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id paket tidak valid")
		return
	}
	// Load current values so partial updates still validate.
	var cur domain.Plan
	var cb, inq, active int
	var limit sql.NullInt32
	err = s.store.DB.QueryRowContext(r.Context(), `SELECT slug, name, price_cents, duration_days,
		max_accounts, api_delay_minutes, notif_interval_minutes, max_devices, callback_enabled, inquiry_enabled, inquiry_limit, is_active
		FROM plans WHERE id=?`, planID).Scan(&cur.Slug, &cur.Name, &cur.PriceCents, &cur.DurationDays,
		&cur.MaxAccounts, &cur.APIDelayMinutes, &cur.NotifIntervalMin, &cur.MaxDevices, &cb, &inq, &limit, &active)
	if err != nil {
		writeErr(w, http.StatusNotFound, "plan_not_found", "paket tidak ditemukan")
		return
	}
	cur.CallbackEnabled = cb == 1
	cur.InquiryEnabled = inq == 1
	cur.InquiryLimit = nullInt32ToPtr(limit)
	cur.IsActive = active == 1
	old := cur // snapshot sebelum field request diterapkan (P2-12)
	cur = applyPlanUpdateRequest(cur, req)
	if err := domain.ValidatePlan(cur); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_plan", err.Error())
		return
	}
	_, err = s.store.DB.ExecContext(r.Context(), `UPDATE plans SET slug=?, name=?, price_cents=?,
		duration_days=?, max_accounts=?, api_delay_minutes=?, notif_interval_minutes=?,
		max_devices=?, callback_enabled=?, inquiry_enabled=?, inquiry_limit=?, is_active=? WHERE id=?`,
		cur.Slug, cur.Name, cur.PriceCents, cur.DurationDays, cur.MaxAccounts, cur.APIDelayMinutes,
		cur.NotifIntervalMin, cur.MaxDevices, boolToInt(cur.CallbackEnabled), boolToInt(cur.InquiryEnabled), intPtrToDB(cur.InquiryLimit), boolToInt(cur.IsActive), planID)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") {
			writeErr(w, http.StatusConflict, "slug_taken", "slug paket sudah dipakai")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengubah paket")
		return
	}
	admin, _ := adminID(r)
	// P2-12: detail audit berisi old -> new (bukan sekadar "plan X").
	s.audit(r, "admin", admin, "plan_update", planUpdateDetail(old, cur))
	writeJSON(w, http.StatusOK, map[string]any{"id": planID, "slug": cur.Slug})
}

func (s *Server) handleAdminDeletePlan(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	planID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id paket tidak valid")
		return
	}
	// P2-10: hapus hanya bila TIDAK ADA langganan AKTIF — subscription
	// cancelled/expired tidak menghalangi hapus.
	var inUse int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM subscriptions WHERE plan_id=? AND status='active' AND expires_at > NOW()`, planID).Scan(&inUse)
	if inUse > 0 {
		writeErr(w, http.StatusConflict, "plan_in_use",
			"paket masih dipakai oleh langganan dan tidak bisa dihapus")
		return
	}
	res, err := s.store.DB.ExecContext(r.Context(), `DELETE FROM plans WHERE id=?`, planID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghapus paket (mungkin masih dipakai langganan)")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, http.StatusNotFound, "plan_not_found", "paket tidak ditemukan")
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "plan_delete", "plan "+r.PathValue("id"))
	writeJSON(w, http.StatusOK, map[string]any{"message": "paket dihapus"})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullInt32ToPtr mengubah sql.NullInt32 dari kolom inquiry_limit menjadi
// *int domain (nil = NULL = tanpa batas).
func nullInt32ToPtr(n sql.NullInt32) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int32)
	return &v
}

// intPtrToDB mengubah *int domain menjadi argumen driver: nil diteruskan
// sebagai NULL, bukan 0.
func intPtrToDB(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// formatInquiryLimitAudit merender batas inquiry untuk detail audit:
// nil = "tanpa batas", N = angkanya.
func formatInquiryLimitAudit(p *int) string {
	if p == nil {
		return "tanpa batas"
	}
	return strconv.Itoa(*p)
}

// handleAdminListMembers — GET /api/v1/admin/members (v23, P2-13/P2-11).
// Query: page (default 1, ukuran halaman tetap 20), q (cocok nama ATAU
// email, LIKE dengan escape wildcard), plan (slug paket langganan aktif
// member — yang masih berlaku, sama seperti kolom plan yang tampil;
// member tanpa paket tidak cocok), status (members.status:
// active/disabled). Semua filter opsional, dikombinasikan AND.
// Respons: {members: [{id, email (ter-mask), name, email_verified,
// plan, accounts, plan_expires_at (WIB RFC3339|null), subscription_status
// ("active"|"expired"|"none")}], page, total_count} — total_count
// dihitung dengan filter yang sama seperti query list.
func (s *Server) handleAdminListMembers(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size := 20
	offset := (page - 1) * size

	where := "WHERE 1=1"
	args := []any{}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		where += " AND (m.name LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\')"
		args = append(args, "%"+escapeLike(v)+"%", "%"+escapeLike(v)+"%")
	}
	if v := strings.TrimSpace(q.Get("plan")); v != "" {
		where += ` AND EXISTS (SELECT 1 FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
			WHERE sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW() AND p.slug=?)`
		args = append(args, v)
	}
	if v := strings.TrimSpace(q.Get("status")); v != "" {
		if v != "active" && v != "disabled" {
			writeErr(w, http.StatusBadRequest, "invalid_param", "parameter status harus active atau disabled")
			return
		}
		where += " AND COALESCE(m.status,'active')=?"
		args = append(args, v)
	}

	var total int
	if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM members m `+where, args...).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghitung member")
		return
	}

	// plan_expires_at: expires_at langganan status='active' terbaru
	// (null bila tidak ada); subscription_status: "active" bila ada
	// langganan aktif yang belum kedaluwarsa, "expired" bila ada
	// langganan aktif tapi semuanya sudah lewat, "none" bila tidak ada.
	listArgs := append(append([]any{}, args...), size, offset)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT m.id, m.email, m.name,
		COALESCE(m.email_verified_at IS NOT NULL, 0),
		(SELECT p.name FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
		  WHERE sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW() ORDER BY sub.expires_at DESC LIMIT 1),
		(SELECT sub.expires_at FROM subscriptions sub
		  WHERE sub.member_id=m.id AND sub.status='active' ORDER BY sub.expires_at DESC LIMIT 1),
		(SELECT CASE
		   WHEN NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.member_id=m.id AND s2.status='active') THEN 'none'
		   WHEN EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.member_id=m.id AND s2.status='active' AND s2.expires_at > NOW()) THEN 'active'
		   ELSE 'expired' END),
		(SELECT COUNT(*) FROM linked_accounts la WHERE la.member_id=m.id)
		FROM members m `+where+` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca member")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, email, name string
		var verified int
		var plan, expires sql.NullString
		var subStatus string
		var accounts int
		if err := rows.Scan(&id, &email, &name, &verified, &plan, &expires, &subStatus, &accounts); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "email": crypto.MaskEmail(email), "name": name,
			"email_verified": verified == 1, "plan": plan.String, "accounts": accounts,
			"plan_expires_at": nullableWIBString(expires), "subscription_status": subStatus,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out, "page": page, "total_count": total})
}

// handlePublicSettings exposes only the brand + feature flags the landing
// page needs (no secrets, no Connecta key). Works without a DB by
// returning the compiled-in defaults.
func (s *Server) handlePublicSettings(w http.ResponseWriter, r *http.Request) {
	settings := map[string]string{
		"site_name":     "MutasiHub",
		"tagline":       "Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern",
		"logo_url":      "",
		"accent_color":  "#0B6B4F",
		"gobiz_enabled": "1",
	}
	if s.store.Available() {
		rows, err := s.store.DB.QueryContext(r.Context(), `SELECT setting_key, COALESCE(value,'') FROM settings`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var k, v string
				if err := rows.Scan(&k, &v); err == nil {
					settings[k] = v
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT setting_key, COALESCE(value,'') FROM settings`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca settings")
		return
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			settings[k] = v
		}
	}
	// Connecta base URL hidup di env server (CONNECTA_BASE_URL), bukan di
	// tabel settings — tanpa ini panel selalu menampilkan "belum diatur"
	// padahal koneksi sudah jalan. API key TIDAK PERNAH dikirim ke panel.
	if s.cfg.ConnectaBaseURL != "" {
		settings["connecta_base_url"] = s.cfg.ConnectaBaseURL
		settings["connecta_configured"] = "1"
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var body map[string]string
	if !readJSON(w, r, &body) {
		return
	}
	allowed := map[string]bool{
		"site_name": true, "tagline": true, "logo_url": true,
		"accent_color": true, "gobiz_enabled": true,
	}
	admin, _ := adminID(r)
	for k, v := range body {
		if !allowed[k] {
			writeErr(w, http.StatusBadRequest, "invalid_setting", "setting tidak dikenal: "+k)
			return
		}
		if err := s.store.SetSetting(r.Context(), k, v); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan setting "+k)
			return
		}
		s.audit(r, "admin", admin, "setting_update", k+"="+v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "settings disimpan"})
}

func (s *Server) handleAdminQuota(w http.ResponseWriter, r *http.Request) {
	raw, err := s.connecta.Quota(r.Context())
	if err != nil {
		s.log.Printf("http: admin quota gagal: %v", err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memuat kuota penyedia, coba lagi nanti")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (s *Server) handleAdminConnectaTest(w http.ResponseWriter, r *http.Request) {
	docs, docsErr := s.connecta.Docs(r.Context())
	quota, quotaErr := s.connecta.Quota(r.Context())
	if docsErr != nil {
		s.log.Printf("http: admin connecta test docs gagal: %v", docsErr)
	}
	if quotaErr != nil {
		s.log.Printf("http: admin connecta test quota gagal: %v", quotaErr)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"docs_ok":     docsErr == nil,
		"quota_ok":    quotaErr == nil,
		"docs":        json.RawMessage(nullIfNil(docs)),
		"quota":       json.RawMessage(nullIfNil(quota)),
		"docs_error":  errString(docsErr),
		"quota_error": errString(quotaErr),
	})
}

func nullIfNil(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

// errString renders a provider error generically for the admin test
// endpoint (P2-2): detail upstream hanya ke log server, bukan ke JSON.
func errString(err error) string {
	if err == nil {
		return ""
	}
	return "layanan penyedia sedang gangguan"
}

func (s *Server) handleAdminSyncStatus(w http.ResponseWriter, r *http.Request) {
	running, lastRun, lastErr := s.syncer.Status()
	out := map[string]any{
		"worker_running": running,
		"last_run":       formatWIB(lastRun),
		"last_error":     lastErr,
	}
	if s.store.Available() {
		rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, provider,
			COALESCE(phone_masked, account_masked, ''), status, last_synced_at
			FROM linked_accounts ORDER BY last_synced_at DESC LIMIT 50`)
		if err == nil {
			defer rows.Close()
			accounts := []map[string]any{}
			for rows.Next() {
				var id, provider, masked, status string
				var last sql.NullTime
				if err := rows.Scan(&id, &provider, &masked, &status, &last); err != nil {
					continue
				}
				item := map[string]any{"id": id, "provider": provider, "masked": masked, "status": status}
				if last.Valid {
					item["last_synced_at"] = formatWIB(last.Time)
				}
				accounts = append(accounts, item)
			}
			out["accounts"] = accounts
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAdminDanaInquiry is admin-only SNAP bank account inquiry
// (bypasses the per-plan gate; members use /api/v1/inquiry/bank-account).
func (s *Server) handleAdminDanaInquiry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.BankCode == "" || req.AccountNumber == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "bank_code dan account_number wajib diisi")
		return
	}
	raw, err := s.connecta.DanaAccountInquiry(r.Context(), req.BankCode, req.AccountNumber)
	if err != nil {
		admin, _ := adminID(r)
		s.audit(r, "admin", admin, "dana_inquiry_failed", "bank "+req.BankCode)
		status, code, msg := classifyInquiryError(err)
		writeErr(w, status, code, msg)
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "dana_inquiry", "bank "+req.BankCode)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// nullableString renders sql.NullString as JSON null when invalid.
func nullableString(ns sql.NullString) any {
	if ns.Valid {
		return ns.String
	}
	return nil
}

// handleAdminGetMember returns one member's detail for the admin panel:
// identity (email masked), active subscription, linked accounts (numbers
// masked at rest), mutation stats and API keys (prefix only).
// No credentials, no raw mutation rows, no balances.
func (s *Server) handleAdminGetMember(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	var email, name, status, createdAt string
	var verified int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT email, name,
		COALESCE(email_verified_at IS NOT NULL, 0), COALESCE(status,'active'), created_at
		FROM members WHERE id=?`, id).Scan(&email, &name, &verified, &status, &createdAt)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "member_not_found", "member tidak ditemukan")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca member")
		return
	}
	// Active subscription (if any).
	var subPlanID sql.NullInt64
	var subPlanName, subStatus, subStarts, subExpires sql.NullString
	// P2-11: hanya subscription aktif yang BELUM kedaluwarsa yang
	// ditampilkan sebagai langganan aktif.
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT p.id, p.name, sub.status, sub.starts_at, sub.expires_at
		FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
		WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() ORDER BY sub.expires_at DESC LIMIT 1`, id).
		Scan(&subPlanID, &subPlanName, &subStatus, &subStarts, &subExpires)
	var subscription any
	if subPlanID.Valid {
		subscription = map[string]any{
			"plan_id": subPlanID.Int64, "plan_name": subPlanName.String,
			"status": subStatus.String, "starts_at": formatWIBString(subStarts.String), "expires_at": formatWIBString(subExpires.String),
		}
	}
	// Linked accounts.
	accRows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, provider, label,
		COALESCE(phone_masked, account_masked, ''), status, last_synced_at, created_at
		FROM linked_accounts WHERE member_id=? ORDER BY created_at DESC`, id)
	accounts := []map[string]any{}
	if err == nil {
		defer accRows.Close()
		for accRows.Next() {
			var aid, provider, label, masked, astatus string
			var synced, acreated sql.NullString
			if err := accRows.Scan(&aid, &provider, &label, &masked, &astatus, &synced, &acreated); err != nil {
				continue
			}
			accounts = append(accounts, map[string]any{
				"id": aid, "provider": provider, "label": label, "masked": masked,
				"status": astatus, "last_synced_at": nullableWIBString(synced), "created_at": formatWIBString(acreated.String),
			})
		}
	}
	// Stats.
	var totalMut, mut30d, keyCount int64
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mutations WHERE member_id=?`, id).Scan(&totalMut)
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mutations WHERE member_id=? AND tx_date >= NOW() - INTERVAL 30 DAY`, id).Scan(&mut30d)
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM api_keys WHERE member_id=?`, id).Scan(&keyCount)
	// API keys (prefix only, never the secret).
	keyRows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, key_prefix, is_active, last_used_at, created_at, expires_at
		FROM api_keys WHERE member_id=? ORDER BY created_at DESC`, id)
	keys := []map[string]any{}
	if err == nil {
		defer keyRows.Close()
		for keyRows.Next() {
			var kid, prefix string
			var kactive int
			var kused, kcreated, kexp sql.NullString
			if err := keyRows.Scan(&kid, &prefix, &kactive, &kused, &kcreated, &kexp); err != nil {
				continue
			}
			keys = append(keys, map[string]any{
				"id": kid, "key_prefix": prefix, "is_active": kactive == 1,
				"last_used_at": nullableWIBString(kused), "created_at": formatWIBString(kcreated.String),
				"expires_at": nullableWIBString(kexp),
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"member": map[string]any{
			"id": id, "email": crypto.MaskEmail(email), "name": name,
			"email_verified": verified == 1, "status": status, "created_at": formatWIBString(createdAt),
		},
		"subscription": subscription,
		"accounts":     accounts,
		"stats": map[string]any{
			"total_mutations": totalMut, "mutations_30d": mut30d, "api_keys": keyCount,
		},
		"api_keys": keys,
	})
}

// handleAdminResetMemberPassword resets a member's password to a fresh
// RANDOM temporary password (P0-B, v21) and forces a password change at
// next login. The temp password is returned ONCE in the response so the
// admin can pass it to the member privately — it is never logged and
// never stored in plaintext. All existing member sessions are revoked
// (session_version+1, P1-2).
func (s *Server) handleAdminResetMemberPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	var exists int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM members WHERE id=?`, id).Scan(&exists)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca member")
		return
	}
	if exists == 0 {
		writeErr(w, http.StatusNotFound, "member_not_found", "member tidak ditemukan")
		return
	}
	temp := randomTempPassword()
	if temp == "" {
		writeErr(w, http.StatusInternalServerError, "server_error", "gagal menyiapkan kata sandi reset")
		return
	}
	hash, err := auth.HashPassword(temp)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server_error", "gagal menyiapkan kata sandi reset")
		return
	}
	if _, err := s.store.DB.ExecContext(r.Context(), `UPDATE members SET password_hash=?, must_change_password=1, session_version=session_version+1 WHERE id=?`, hash, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal mereset kata sandi")
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "member_password_reset", "member "+id+" kata sandi direset admin")
	writeJSON(w, http.StatusOK, map[string]any{"reset": true, "temp_password": temp})
}

// handleAdminUpdateMember edits a member: name, email, plan (assign/replace the
// active subscription), and account status (active/disabled). Only fields
// present in the body change; a plan change closes the current active
// subscription and opens a new one for the plan's duration.
//
// Email change (v20): when the email actually changes, google_sub is
// cleared and email_verified_at reset, so the next Google login matches
// by the NEW email and links automatically — the member keeps the same
// member_id and all its data (subscription, accounts, mutations, keys).
func (s *Server) handleAdminUpdateMember(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	var req struct {
		Name   *string `json:"name"`
		Email  *string `json:"email"`
		PlanID *int64  `json:"plan_id"`
		Status *string `json:"status"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	name := ""
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" || len(name) > 255 {
			writeErr(w, http.StatusBadRequest, "invalid_name", "nama tidak boleh kosong (maks 255 karakter)")
			return
		}
	}
	email := ""
	if req.Email != nil {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
		if !validEmail(email) {
			writeErr(w, http.StatusBadRequest, "invalid_email", "format email tidak valid")
			return
		}
	}
	status := ""
	if req.Status != nil {
		status = *req.Status
		if status != "active" && status != "disabled" {
			writeErr(w, http.StatusBadRequest, "invalid_status", "status harus active atau disabled")
			return
		}
	}
	var curEmail, curStatus, curName string
	var curPlanName sql.NullString
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT email, COALESCE(status,'active'), name FROM members WHERE id=?`, id).Scan(&curEmail, &curStatus, &curName)
	if err == nil {
		_ = s.store.DB.QueryRowContext(r.Context(), `SELECT p.name FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id
			WHERE sub.member_id=? AND sub.status='active' AND sub.expires_at > NOW() ORDER BY sub.expires_at DESC LIMIT 1`, id).Scan(&curPlanName)
	}
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "member_not_found", "member tidak ditemukan")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca member")
		return
	}
	emailChanged := req.Email != nil && email != curEmail
	if emailChanged {
		var taken int
		if err := s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM members WHERE email=? AND id<>?`, email, id).Scan(&taken); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal memeriksa email")
			return
		}
		if taken > 0 {
			writeErr(w, http.StatusConflict, "email_taken", "email sudah dipakai member lain")
			return
		}
	}
	durationDays := 0
	var newPlanName string
	if req.PlanID != nil {
		// P2-10: paket nonaktif (is_active=0) TIDAK boleh di-assign.
		var planActive int
		err := s.store.DB.QueryRowContext(r.Context(), `SELECT duration_days, name, is_active FROM plans WHERE id=?`, *req.PlanID).Scan(&durationDays, &newPlanName, &planActive)
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusNotFound, "plan_not_found", "paket tidak ditemukan")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca paket")
			return
		}
		if planActive != 1 {
			writeErr(w, http.StatusConflict, "plan_inactive", "paket sudah nonaktif dan tidak bisa di-assign ke member")
			return
		}
		if durationDays < 1 {
			durationDays = 30
		}
	}
	tx, err := s.store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal memulai transaksi")
		return
	}
	defer tx.Rollback()
	if req.Name != nil {
		if _, err := tx.ExecContext(r.Context(), `UPDATE members SET name=? WHERE id=?`, name, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengubah nama")
			return
		}
	}
	if emailChanged {
		if _, err := tx.ExecContext(r.Context(), `UPDATE members SET email=?, google_sub=NULL, email_verified_at=NULL WHERE id=?`, email, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengubah email")
			return
		}
	}
	if req.Status != nil {
		if _, err := tx.ExecContext(r.Context(), `UPDATE members SET status=? WHERE id=?`, status, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengubah status")
			return
		}
	}
	if req.PlanID != nil {
		if _, err := tx.ExecContext(r.Context(), `UPDATE subscriptions SET status='cancelled' WHERE member_id=? AND status='active'`, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal menutup paket lama")
			return
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO subscriptions (id, member_id, plan_id, status, starts_at, expires_at)
			VALUES (?, ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`, newID(), id, *req.PlanID, durationDays); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", "gagal mengaktifkan paket baru")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menyimpan perubahan")
		return
	}
	admin, _ := adminID(r)
	// P2-12: detail audit old -> new; email di-mask (PII tidak mentah).
	changes := []string{}
	if req.Name != nil {
		changes = append(changes, "nama: '"+curName+"' -> '"+name+"'")
	}
	if emailChanged {
		changes = append(changes, "email: '"+crypto.MaskEmail(curEmail)+"' -> '"+crypto.MaskEmail(email)+"'")
	}
	if req.PlanID != nil {
		changes = append(changes, "paket: '"+curPlanName.String+"' -> '"+newPlanName+"'")
	}
	if req.Status != nil {
		changes = append(changes, "status: '"+curStatus+"' -> '"+status+"'")
	}
	s.audit(r, "admin", admin, "member_update", "member "+id+" diubah ("+strings.Join(changes, "; ")+")")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

// inquiryLimitEqual membandingkan dua batas inquiry dengan semantik
// pointer: nil != 0, nil == nil, N == N.
func inquiryLimitEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// planUpdateDetail renders old -> new for plan_update audit rows (P2-12).
func planUpdateDetail(old, cur domain.Plan) string {
	parts := []string{}
	if old.Slug != cur.Slug {
		parts = append(parts, "slug: '"+old.Slug+"' -> '"+cur.Slug+"'")
	}
	if old.Name != cur.Name {
		parts = append(parts, "nama: '"+old.Name+"' -> '"+cur.Name+"'")
	}
	if old.PriceCents != cur.PriceCents {
		parts = append(parts, "harga: "+strconv.FormatInt(old.PriceCents, 10)+" -> "+strconv.FormatInt(cur.PriceCents, 10))
	}
	if old.DurationDays != cur.DurationDays {
		parts = append(parts, "durasi: "+strconv.Itoa(old.DurationDays)+" -> "+strconv.Itoa(cur.DurationDays))
	}
	if old.MaxAccounts != cur.MaxAccounts {
		parts = append(parts, "max_rekening: "+strconv.Itoa(old.MaxAccounts)+" -> "+strconv.Itoa(cur.MaxAccounts))
	}
	if !inquiryLimitEqual(old.InquiryLimit, cur.InquiryLimit) {
		parts = append(parts, "limit_inquiry: "+formatInquiryLimitAudit(old.InquiryLimit)+" -> "+formatInquiryLimitAudit(cur.InquiryLimit))
	}
	if old.IsActive != cur.IsActive {
		parts = append(parts, "aktif: "+strconv.FormatBool(old.IsActive)+" -> "+strconv.FormatBool(cur.IsActive))
	}
	if len(parts) == 0 {
		return "plan tidak berubah"
	}
	return strings.Join(parts, "; ")
}

// handleAdminAuditLogs — GET /api/v1/admin/audit-logs (P2-12, admin only).
// Query: actor (cocok actor_type persis ATAU actor_id mengandung nilai),
// action (mengandung nilai), page (default 1), page_size (default 20,
// clamp 1..100). Respons: {audit_logs, page, page_size, total_count}.
func (s *Server) handleAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if size < 1 || size > 100 {
		size = 20
	}
	where := "WHERE 1=1"
	args := []any{}
	if v := strings.TrimSpace(r.URL.Query().Get("actor")); v != "" {
		where += " AND (actor_type=? OR actor_id LIKE ?)"
		args = append(args, v, "%"+v+"%")
	}
	if v := strings.TrimSpace(r.URL.Query().Get("action")); v != "" {
		where += " AND action LIKE ?"
		args = append(args, "%"+v+"%")
	}
	var total int
	_ = s.store.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM audit_logs `+where, args...).Scan(&total)
	listArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT id, actor_type, actor_id, action,
		COALESCE(detail,''), COALESCE(ip,''), created_at FROM audit_logs `+where+`
		ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca audit log")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var logID int64
		var actorType, actorID, action, detail, ip, created string
		if err := rows.Scan(&logID, &actorType, &actorID, &action, &detail, &ip, &created); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": logID, "actor_type": actorType, "actor_id": actorID,
			"action": action, "detail": detail, "ip": ip,
			"created_at": formatWIBString(created),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"audit_logs": out, "page": page, "page_size": size, "total_count": total,
	})
}

// handleAdminConnectaWebhookStatus — GET /api/v1/admin/connecta/webhook
// (P2-23, admin read-only): menanyakan pendaftaran webhook ke provider
// (GET /b2b/webhook) dan membandingkan URL terdaftar dengan URL webhook
// kita. Secret TIDAK PERNAH dikembalikan.
//
// Keterbatasan (dicatat, bukan dipaksakan HMAC): Connecta memakai
// shared secret (header X-Webhook-Secret / field body `secret`), bukan
// HMAC atas body + timestamp — jadi tidak ada verifikasi HMAC yang
// bisa ditambahkan di sisi kita; autentikasi webhook tetap secret
// tersebut (lihat handleConnectaWebhook).
func (s *Server) handleAdminConnectaWebhookStatus(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	expected := strings.TrimRight(s.cfg.FrontendURL, "/") + "/webhooks/connecta"
	raw, err := s.connecta.WebhookGet(r.Context())
	if err != nil {
		s.log.Printf("http: admin webhook status gagal: %v", err)
		writeErr(w, http.StatusServiceUnavailable, "provider_error", "gagal memeriksa pendaftaran webhook ke penyedia, coba lagi nanti")
		return
	}
	registered := extractWebhookURL(raw)
	writeJSON(w, http.StatusOK, map[string]any{
		"registered_url": registered,
		"expected_url":   expected,
		"matches":        registered != "" && registered == expected,
		"configured":     s.cfg.ConnectaWebhookSecret != "",
	})
}

// extractWebhookURL mengambil URL webhook terdaftar dari payload
// GET /b2b/webhook (bentuk longgar: webhook_url / url, top-level atau
// di bawah data).
func extractWebhookURL(raw json.RawMessage) string {
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return ""
	}
	candidates := []map[string]any{doc}
	if data, ok := doc["data"].(map[string]any); ok {
		candidates = append(candidates, data)
	}
	for _, m := range candidates {
		for _, k := range []string{"webhook_url", "url"} {
			if v, ok := m[k].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

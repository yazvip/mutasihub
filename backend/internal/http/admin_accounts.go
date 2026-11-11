package http

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"mutasi-hub/internal/crypto"
	syncpkg "mutasi-hub/internal/sync"
)

// v40: Daftar Rekening admin — daftar semua rekening terhubung (DANA/BCA)
// beserta member, saldo, transaksi terakhir, dan status (termasuk "beku"
// bila sync dijeda karena max_accounts paket member).
//
// Keamanan: HANYA nomor tersamar (phone_masked/account_masked) yang keluar.
// credential_ciphertext dan nomor asli tidak pernah dipilih dari DB.

// frozenAccountExpr — predikat SQL "rekening ini beku", paritas persis
// dengan domain.FrozenAccountIDs: di antara rekening kandidat member
// (status active/pending), yang N tertua dipertahankan (N = max_accounts
// paket aktif member; tanpa paket aktif N = 0 alias semua beku); urutan
// created_at ASC, seri dipecah id ASC. Dipakai di WHERE (filter status)
// maupun SELECT (flag sync_paused per baris).
const frozenAccountExpr = `(la.status IN ('active','pending') AND (SELECT COUNT(*) FROM linked_accounts la2
	WHERE la2.member_id = la.member_id AND la2.status IN ('active','pending')
	AND (la2.created_at < la.created_at OR (la2.created_at = la.created_at AND la2.id < la.id))
) >= COALESCE((SELECT p.max_accounts FROM subscriptions sub JOIN plans p ON p.id = sub.plan_id
	WHERE sub.member_id = la.member_id AND sub.status = 'active' AND sub.expires_at > NOW() LIMIT 1), 0))`

// accountDisplayStatus menurunkan status tampil: "frozen" bila sync dijeda,
// selain itu status DB apa adanya (active/pending/...).
func accountDisplayStatus(dbStatus string, frozen bool) string {
	if frozen {
		return "frozen"
	}
	return strings.ToLower(strings.TrimSpace(dbStatus))
}

// accountSortClause memetakan parameter sortir ke ORDER BY (whitelist —
// nilai di luar daftar ditolak pemanggil dengan 400).
func accountSortClause(sort string) (string, bool) {
	switch sort {
	case "", "created":
		return "la.created_at DESC, la.id DESC", true
	case "balance":
		return "la.balance_cents DESC, la.created_at DESC", true
	case "synced":
		return "la.last_synced_at DESC, la.created_at DESC", true
	default:
		return "", false
	}
}

type adminAccountLastTx struct {
	Date        string `json:"date"`
	AmountCents int64  `json:"amount_cents"`
	Type        string `json:"type"`
}

// accountListWhere menyusun klausa WHERE (+ argumen) untuk daftar rekening
// dari filter query: q (nomor tersamar / nama / email member), provider,
// status tampil (active/pending/frozen). Dipakai query COUNT maupun list
// agar keduanya selalu konsisten.
func accountListWhere(q map[string][]string) (string, []any, bool) {
	where := "WHERE 1=1"
	args := []any{}
	if v := strings.TrimSpace(firstQuery(q, "q")); v != "" {
		where += " AND (la.phone_masked LIKE ? ESCAPE '\\' OR la.account_masked LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\')"
		like := "%" + escapeLike(v) + "%"
		args = append(args, like, like, like, like)
	}
	if v := strings.ToUpper(strings.TrimSpace(firstQuery(q, "provider"))); v != "" {
		if v != "DANA" && v != "BCA" {
			return "", nil, false
		}
		where += " AND la.provider=?"
		args = append(args, v)
	}
	switch v := strings.ToLower(strings.TrimSpace(firstQuery(q, "status"))); v {
	case "":
	case "active":
		where += " AND la.status='active' AND NOT " + frozenAccountExpr
	case "pending":
		where += " AND la.status='pending' AND NOT " + frozenAccountExpr
	case "frozen":
		where += " AND " + frozenAccountExpr
	default:
		return "", nil, false
	}
	return where, args, true
}

func firstQuery(q map[string][]string, key string) string {
	if vs, ok := q[key]; ok && len(vs) > 0 {
		return vs[0]
	}
	return ""
}

// adminAccountsSummarySQL — query ringkasan header daftar rekening.
// frozen_count memakai frozenAccountExpr yang SAMA dengan flag beku per
// baris, supaya angka kartu "Status Beku" selalu cocok dengan pill Beku
// di daftar (angka mockup v41 — Beku 1 — adalah ilustrasi; yang live
// adalah hitungan nyata ini).
func adminAccountsSummarySQL() string {
	return `SELECT COUNT(*), COALESCE(SUM(balance_cents),0),
		COALESCE(SUM(provider='DANA'),0), COALESCE(SUM(provider='BCA'),0), COALESCE(SUM(status='pending'),0),
		COALESCE(SUM(` + frozenAccountExpr + `),0)
		FROM linked_accounts la`
}

func (s *Server) handleAdminListAccounts(w http.ResponseWriter, r *http.Request) {
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

	orderBy, ok := accountSortClause(q.Get("sort"))
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_param", "parameter sort harus created, balance, atau synced")
		return
	}
	where, args, ok := accountListWhere(q)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_param", "parameter provider harus DANA atau BCA, status harus active, pending, atau frozen")
		return
	}

	var total int
	if err := s.store.DB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM linked_accounts la JOIN members m ON m.id=la.member_id `+where, args...).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal menghitung rekening")
		return
	}

	// Ringkasan header (global, tanpa filter): total rekening, total saldo,
	// jumlah DANA, jumlah BCA, jumlah pending, jumlah beku.
	var summary struct {
		Total    int
		TotalBal int64
		Dana     int
		BCA      int
		Pending  int
		Frozen   int
	}
	_ = s.store.DB.QueryRowContext(r.Context(), adminAccountsSummarySQL()).Scan(&summary.Total, &summary.TotalBal, &summary.Dana, &summary.BCA, &summary.Pending, &summary.Frozen)

	listArgs := append(append([]any{}, args...), size, offset)
	rows, err := s.store.DB.QueryContext(r.Context(), `SELECT la.id, la.provider, la.label,
		COALESCE(la.phone_masked,''), COALESCE(la.account_masked,''), la.status, la.balance_cents,
		la.last_synced_at, la.created_at, la.authorized_at,
		m.id, m.name, m.email, `+frozenAccountExpr+` AS frozen,
		(SELECT mu.tx_date FROM mutations mu WHERE mu.linked_account_id=la.id ORDER BY mu.tx_date DESC, mu.id DESC LIMIT 1),
		(SELECT mu.amount_cents FROM mutations mu WHERE mu.linked_account_id=la.id ORDER BY mu.tx_date DESC, mu.id DESC LIMIT 1),
		(SELECT mu.type FROM mutations mu WHERE mu.linked_account_id=la.id ORDER BY mu.tx_date DESC, mu.id DESC LIMIT 1),
		(SELECT COUNT(*) FROM mutations mu WHERE mu.linked_account_id=la.id)
		FROM linked_accounts la JOIN members m ON m.id=la.member_id `+where+`
		ORDER BY `+orderBy+` LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca rekening")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, provider, label, phoneMasked, accountMasked, dbStatus string
		var balance int64
		var lastSynced, created, authorized sql.NullTime
		var memberID, memberName, memberEmail string
		var frozen int
		var lastTxDate sql.NullTime
		var lastTxAmount sql.NullInt64
		var lastTxType sql.NullString
		var txCount int
		if err := rows.Scan(&id, &provider, &label, &phoneMasked, &accountMasked, &dbStatus, &balance,
			&lastSynced, &created, &authorized,
			&memberID, &memberName, &memberEmail, &frozen,
			&lastTxDate, &lastTxAmount, &lastTxType, &txCount); err != nil {
			continue
		}
		masked := phoneMasked
		if masked == "" {
			masked = accountMasked
		}
		var lastTx any
		if lastTxDate.Valid {
			lastTx = map[string]any{
				"date":         formatWIBWallClock(lastTxDate.Time),
				"amount_cents": lastTxAmount.Int64,
				"type":         lastTxType.String,
			}
		}
		var lastSyncedAt any
		if lastSynced.Valid {
			lastSyncedAt = formatWIB(lastSynced.Time)
		}
		var createdAt any
		if created.Valid {
			createdAt = formatWIB(created.Time)
		}
		var authorizedAt any
		if authorized.Valid {
			authorizedAt = formatWIB(authorized.Time)
		}
		out = append(out, map[string]any{
			"id": id, "provider": provider, "label": label, "masked": masked,
			"member":        map[string]any{"id": memberID, "name": memberName, "email": crypto.MaskEmail(memberEmail)},
			"balance_cents": balance, "status": accountDisplayStatus(dbStatus, frozen == 1),
			"last_synced_at": lastSyncedAt, "created_at": createdAt, "authorized_at": authorizedAt,
			"last_tx": lastTx, "tx_count": txCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts": out, "page": page, "total_count": total,
		"summary": map[string]any{
			"total_accounts": summary.Total, "total_balance_cents": summary.TotalBal,
			"dana_count": summary.Dana, "bca_count": summary.BCA, "pending_count": summary.Pending,
			"frozen_count": summary.Frozen,
		},
	})
}

// handleAdminGetAccount mengembalikan detail satu rekening + 10 mutasi
// terakhirnya. Read-only; nomor hanya tersamar; dibaca admin diaudit.
func (s *Server) handleAdminGetAccount(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	var accID, provider, label, phoneMasked, accountMasked, dbStatus string
	var balance int64
	var lastSynced, created, authorized sql.NullTime
	var memberID, memberName, memberEmail string
	var frozen int
	err := s.store.DB.QueryRowContext(r.Context(), `SELECT la.id, la.provider, la.label,
		COALESCE(la.phone_masked,''), COALESCE(la.account_masked,''), la.status, la.balance_cents,
		la.last_synced_at, la.created_at, la.authorized_at,
		m.id, m.name, m.email, `+frozenAccountExpr+` AS frozen
		FROM linked_accounts la JOIN members m ON m.id=la.member_id WHERE la.id=?`, id).Scan(
		&accID, &provider, &label, &phoneMasked, &accountMasked, &dbStatus, &balance,
		&lastSynced, &created, &authorized, &memberID, &memberName, &memberEmail, &frozen)
	if err != nil {
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusNotFound, "not_found", "rekening tidak ditemukan")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "gagal membaca rekening")
		return
	}
	admin, _ := adminID(r)
	s.audit(r, "admin", admin, "account_view", "rekening "+id)

	masked := phoneMasked
	if masked == "" {
		masked = accountMasked
	}
	var lastSyncedAt any
	if lastSynced.Valid {
		lastSyncedAt = formatWIB(lastSynced.Time)
	}
	var createdAt any
	if created.Valid {
		createdAt = formatWIB(created.Time)
	}
	var authorizedAt any
	if authorized.Valid {
		authorizedAt = formatWIB(authorized.Time)
	}
	account := map[string]any{
		"id": accID, "provider": provider, "label": label, "masked": masked,
		"member":        map[string]any{"id": memberID, "name": memberName, "email": crypto.MaskEmail(memberEmail)},
		"balance_cents": balance, "status": accountDisplayStatus(dbStatus, frozen == 1),
		"last_synced_at": lastSyncedAt, "created_at": createdAt, "authorized_at": authorizedAt,
	}

	mutRows, err := s.store.DB.QueryContext(r.Context(), `SELECT tx_date, type, amount_cents, description, sender
		FROM mutations WHERE linked_account_id=? ORDER BY tx_date DESC, id DESC LIMIT 10`, id)
	muts := []map[string]any{}
	if err == nil {
		defer mutRows.Close()
		for mutRows.Next() {
			var txDate sql.NullTime
			var mtype string
			var amount int64
			var desc, sender sql.NullString
			if err := mutRows.Scan(&txDate, &mtype, &amount, &desc, &sender); err != nil {
				continue
			}
			var date any
			if txDate.Valid {
				date = formatWIBWallClock(txDate.Time)
			}
			muts = append(muts, map[string]any{
				"tx_date": date, "type": mtype, "amount_cents": amount,
				"description": nullableString(desc), "sender": nullableString(sender),
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": account, "mutations": muts})
}

// mapSyncAccountError memetakan error sync manual ke status HTTP + kode
// + pesan Indonesia (pola repo: pesan ramah untuk admin, kode untuk
// frontend). Error provider yang tidak dikenal → 503 provider_error
// (bukan 502, pola v28).
func mapSyncAccountError(err error) (status int, code, message string) {
	switch {
	case errors.Is(err, syncpkg.ErrSyncAccountNotFound):
		return http.StatusNotFound, "not_found", "rekening tidak ditemukan"
	case errors.Is(err, syncpkg.ErrSyncAccountFrozen):
		return http.StatusConflict, "account_frozen", "rekening dibekukan karena paket member — sinkronisasi dijeda sampai paket dinaikkan atau rekening dilepas"
	case errors.Is(err, syncpkg.ErrSyncAccountInactive):
		return http.StatusConflict, "account_inactive", "rekening tidak aktif sehingga tidak bisa disinkronkan"
	case errors.Is(err, syncpkg.ErrSyncNoSubscription):
		return http.StatusConflict, "subscription_inactive", "member tidak punya langganan aktif sehingga rekening tidak bisa disinkronkan"
	case errors.Is(err, syncpkg.ErrSyncNotBound):
		return http.StatusConflict, "account_not_bound", "rekening DANA belum terhubung — member harus menyelesaikan otorisasi DANA dulu"
	case errors.Is(err, syncpkg.ErrSyncBCAGuard):
		return http.StatusConflict, "bca_sync_rejected", "sinkronisasi BCA ditolak: lebih dari 1 akun BCA aktif di platform"
	default:
		return http.StatusServiceUnavailable, "provider_error", "penyedia gagal merespons, coba lagi sebentar"
	}
}

// handleAdminSyncAccount memicu sync manual SATU rekening (tombol
// Sinkron di kartu Daftar Rekening, v41). Admin-only, diaudit.
// Mengembalikan saldo + terakhir sinkron + status tampil + mutasi baru
// pasca-sync; sync palsu tidak pernah dibuat — bila provider gagal,
// error dipetakan jujur oleh mapSyncAccountError.
func (s *Server) handleAdminSyncAccount(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.PathValue("id")
	admin, _ := adminID(r)
	res, err := s.syncer.SyncAccountByID(r.Context(), id)
	if err != nil {
		status, code, message := mapSyncAccountError(err)
		s.audit(r, "admin", admin, "account_sync_failed", "rekening "+id+" ("+code+")")
		writeErr(w, status, code, message)
		return
	}
	s.audit(r, "admin", admin, "account_sync", "rekening "+id)
	var lastSyncedAt any
	if !res.LastSyncedAt.IsZero() {
		lastSyncedAt = formatWIB(res.LastSyncedAt)
	}
	msg := "Sinkronisasi selesai: tidak ada mutasi baru."
	if res.NewMutations == 1 {
		msg = "Sinkronisasi selesai: 1 mutasi baru."
	} else if res.NewMutations > 1 {
		msg = "Sinkronisasi selesai: " + strconv.Itoa(res.NewMutations) + " mutasi baru."
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"account_id": res.AccountID, "status": accountDisplayStatus(res.DBStatus, res.Frozen),
		"balance_cents": res.BalanceCents, "last_synced_at": lastSyncedAt,
		"new_mutations": res.NewMutations, "message": msg,
	})
}

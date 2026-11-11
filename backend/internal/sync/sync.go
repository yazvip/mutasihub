// Package sync polls Connecta for new DANA transactions and BCA
// mutations per linked account, deduplicates by SHA-256 hash, stores
// balance snapshots, triggers Enterprise callbacks and writes audit rows.
// The worker goroutine always has an exit path via context cancellation.
package sync

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mutasi-hub/internal/connecta"
	"mutasi-hub/internal/crypto"
	"mutasi-hub/internal/db"
	"mutasi-hub/internal/domain"
)

// MutationHash is the dedup key: SHA-256 over member, linked account,
// provider, and the transaction fields. The date is normalized to UTC
// RFC3339 before hashing, so the same instant written in different
// textual formats hashes identically, and two members with an identical
// transaction no longer collide (unique key is per linked_account_id,
// migration 0007). Rows with an unparseable date are never hashed:
// callers must reject them (see parseTxDate).
func MutationHash(memberID, accountID, provider string, date time.Time, typ string, amountCents int64, description string) string {
	h := sha256.New()
	_, _ = fmt.Fprintf(h, "%s|%s|%s|%s|%s|%d|%s",
		memberID, accountID, strings.ToUpper(provider),
		date.UTC().Format(time.RFC3339), typ, amountCents, description)
	return hex.EncodeToString(h.Sum(nil))
}

// Syncer polls Connecta on a ticker.
type Syncer struct {
	store    *db.Store
	connecta *connecta.Client
	encKey   []byte
	log      *log.Logger
	running  bool
	lastRun  time.Time
	lastErr  string
}

// Sentinel errors untuk sync manual per-rekening (v41): dipetakan handler
// HTTP ke status/kode yang jujur. PollOnce hanya me-log error apa adanya,
// jadi sentinel ini tidak mengubah perilaku worker latar.
var (
	ErrSyncAccountNotFound = errors.New("sync: account not found")
	ErrSyncAccountFrozen   = errors.New("sync: account frozen")
	ErrSyncAccountInactive = errors.New("sync: account not active")
	ErrSyncNoSubscription  = errors.New("sync: no active subscription")
	ErrSyncNotBound        = errors.New("sync: dana account not bound")
	ErrSyncBCAGuard        = errors.New("sync: bca guard")
)

// SyncAccountResult — hasil sync manual satu rekening: keadaan terbaru
// pasca-sync supaya frontend bisa me-refresh kartu tanpa menebak.
type SyncAccountResult struct {
	AccountID    string
	DBStatus     string // status DB apa adanya (handler yang memetakan ke status tampil)
	Frozen       bool
	BalanceCents int64
	LastSyncedAt time.Time // zero bila belum pernah sinkron
	NewMutations int
}

// New creates a Syncer. encKey may be nil (then credential decryption is skipped).
func New(store *db.Store, c *connecta.Client, encKey []byte) *Syncer {
	return &Syncer{store: store, connecta: c, encKey: encKey, log: log.Default()}
}

// Start runs the polling loop until ctx is cancelled.
func (s *Syncer) Start(ctx context.Context) {
	s.running = true
	ticker := time.NewTicker(time.Minute)
	defer func() {
		ticker.Stop()
		s.running = false
	}()
	// One immediate pass, then tick.
	s.PollOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			s.log.Println("sync: worker stopped")
			return
		case <-ticker.C:
			s.PollOnce(ctx)
		}
	}
}

// Status reports worker state for /admin/sync-status.
func (s *Syncer) Status() (running bool, lastRun time.Time, lastErr string) {
	return s.running, s.lastRun, s.lastErr
}

type accountRow struct {
	ID             string
	MemberID       string
	Provider       string
	Status         string
	PhoneMask      sql.NullString
	AcctMask       sql.NullString
	Credential     sql.NullString
	CallbackFlag   int
	CallbackURL    sql.NullString
	CallbackSecret sql.NullString
	DelayMin       int
	LastSynced     sql.NullTime
	MaxAccounts    int
	CreatedAt      time.Time
}

// PollOnce syncs every active linked account whose subscription is
// active and whose poll interval (plan api_delay_minutes) has elapsed.
// It is a no-op when the DB or Connecta is unavailable.
func (s *Syncer) PollOnce(ctx context.Context) {
	s.lastRun = time.Now()
	if !s.store.Available() || !s.connecta.Available() {
		return
	}
	rows, err := s.store.DB.QueryContext(ctx, `
		SELECT la.id, la.member_id, la.provider, la.status, la.phone_masked, la.account_masked,
		       la.credential_ciphertext, la.last_synced_at,
		       COALESCE(p.callback_enabled, 0) = 1, m.callback_url, m.callback_secret,
		       COALESCE(p.api_delay_minutes, 10), COALESCE(p.max_accounts, 2), la.created_at
		FROM linked_accounts la
		JOIN members m ON m.id = la.member_id
		LEFT JOIN subscriptions sub ON sub.member_id = la.member_id AND sub.status = 'active' AND sub.expires_at > NOW()
		LEFT JOIN plans p ON p.id = sub.plan_id
		WHERE la.status IN ('active', 'pending')
		AND EXISTS (SELECT 1 FROM subscriptions sub2
			WHERE sub2.member_id = la.member_id AND sub2.status = 'active' AND sub2.expires_at > NOW())
		ORDER BY la.member_id, la.created_at ASC, la.id ASC`)
	if err != nil {
		s.lastErr = err.Error()
		s.log.Printf("sync: list accounts: %v", err)
		return
	}
	defer rows.Close()
	// Kumpulkan dulu semua baris: beku sync dihitung per member SEKALI
	// per run dengan helper yang sama seperti handleListAccounts
	// (domain.FrozenAccountIDs) — N pertama (created_at ASC, tiebreak
	// ID) dipertahankan, sisanya dilewati. Deduplikasi per ID: LEFT
	// JOIN ke subscriptions bisa menggandakan baris bila member punya
	// >1 langganan aktif (data lama pra-cancel-old).
	accounts := []*accountRow{}
	seen := map[string]bool{}
	maxByMember := map[string]int{}
	for rows.Next() {
		a := &accountRow{}
		if err := rows.Scan(&a.ID, &a.MemberID, &a.Provider, &a.Status, &a.PhoneMask, &a.AcctMask,
			&a.Credential, &a.LastSynced, &a.CallbackFlag, &a.CallbackURL, &a.CallbackSecret, &a.DelayMin,
			&a.MaxAccounts, &a.CreatedAt); err != nil {
			// Scan order mismatch guard: log and continue, never crash the loop.
			s.log.Printf("sync: scan account: %v", err)
			continue
		}
		if seen[a.ID] {
			continue
		}
		seen[a.ID] = true
		maxByMember[a.MemberID] = a.MaxAccounts
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		s.lastErr = err.Error()
	}
	byMember := map[string][]domain.FreezeCandidate{}
	for _, a := range accounts {
		byMember[a.MemberID] = append(byMember[a.MemberID], domain.FreezeCandidate{ID: a.ID, CreatedAt: a.CreatedAt})
	}
	frozen := map[string]bool{}
	for memberID, cands := range byMember {
		for id := range domain.FrozenAccountIDs(cands, maxByMember[memberID]) {
			frozen[id] = true
		}
	}
	for _, a := range accounts {
		if frozen[a.ID] {
			continue
		}
		if a.DelayMin > 0 && a.LastSynced.Valid && time.Since(a.LastSynced.Time) < time.Duration(a.DelayMin)*time.Minute {
			continue
		}
		if err := s.syncAccount(ctx, a); err != nil {
			s.lastErr = err.Error()
			s.log.Printf("sync: account %s: %v", a.ID, err)
			continue
		}
	}
}

// countMutations menghitung jumlah mutasi tersimpan satu rekening
// (dipakai sync manual untuk menghitung mutasi baru = sesudah - sebelum).
func (s *Syncer) countMutations(ctx context.Context, accountID string) (int, error) {
	var n int
	err := s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM mutations WHERE linked_account_id=?`, accountID).Scan(&n)
	return n, err
}

type accountCredential struct {
	Phone     string `json:"phone"`
	AccountNo string `json:"account_no"`
	UserID    string `json:"user_id"`
	Pin       string `json:"pin"`
}

// decryptCredential mendekripsi + mem-parse kredensial satu rekening.
// Satu jalur dipakai syncAccount (worker) dan SyncAccountByID (manual).
func (s *Syncer) decryptCredential(a *accountRow) (accountCredential, error) {
	var cred accountCredential
	if !a.Credential.Valid || a.Credential.String == "" || len(s.encKey) == 0 {
		return cred, fmt.Errorf("no decryptable credential for account %s", a.ID)
	}
	plain, err := crypto.Decrypt(s.encKey, a.Credential.String)
	if err != nil {
		return cred, fmt.Errorf("decrypt credential: %w", err)
	}
	if err := json.Unmarshal([]byte(plain), &cred); err != nil {
		return cred, fmt.Errorf("parse credential: %w", err)
	}
	return cred, nil
}

// SyncAccountByID menjalankan sync manual untuk SATU rekening (tombol
// Sinkron di kartu Daftar Rekening admin). Berbeda dengan PollOnce, sync
// manual MENGABAIKAN jeda api_delay_minutes — admin memintanya secara
// eksplisit — tapi tetap menolak rekening beku (sync dijeda karena
// max_accounts paket), rekening tidak aktif, dan rekening tanpa langganan
// aktif. Untuk DANA pending, binding diperiksa dulu: bila belum
// ter-binding, kembalikan ErrSyncNotBound secara jujur (syncDANA diam
// saja bila belum bound — jangan pura-pura sinkron).
func (s *Syncer) SyncAccountByID(ctx context.Context, id string) (*SyncAccountResult, error) {
	a := &accountRow{}
	err := s.store.DB.QueryRowContext(ctx, `
		SELECT la.id, la.member_id, la.provider, la.status, la.phone_masked, la.account_masked,
		       la.credential_ciphertext, la.last_synced_at,
		       COALESCE(p.callback_enabled, 0) = 1, m.callback_url, m.callback_secret,
		       COALESCE(p.api_delay_minutes, 10), COALESCE(p.max_accounts, 2), la.created_at
		FROM linked_accounts la
		JOIN members m ON m.id = la.member_id
		LEFT JOIN subscriptions sub ON sub.member_id = la.member_id AND sub.status = 'active' AND sub.expires_at > NOW()
		LEFT JOIN plans p ON p.id = sub.plan_id
		WHERE la.id = ?`, id).Scan(&a.ID, &a.MemberID, &a.Provider, &a.Status, &a.PhoneMask, &a.AcctMask,
		&a.Credential, &a.LastSynced, &a.CallbackFlag, &a.CallbackURL, &a.CallbackSecret, &a.DelayMin,
		&a.MaxAccounts, &a.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrSyncAccountNotFound
		}
		return nil, err
	}
	if a.Status != "active" && a.Status != "pending" {
		return nil, ErrSyncAccountInactive
	}
	var hasSub int
	if err := s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM subscriptions
		WHERE member_id=? AND status='active' AND expires_at > NOW()`, a.MemberID).Scan(&hasSub); err != nil {
		return nil, err
	}
	if hasSub == 0 {
		return nil, ErrSyncNoSubscription
	}
	// Beku? Hitung dengan helper yang sama seperti PollOnce.
	candRows, err := s.store.DB.QueryContext(ctx, `SELECT id, created_at FROM linked_accounts
		WHERE member_id=? AND status IN ('active','pending') ORDER BY created_at ASC, id ASC`, a.MemberID)
	if err != nil {
		return nil, err
	}
	cands := []domain.FreezeCandidate{}
	for candRows.Next() {
		var c domain.FreezeCandidate
		if err := candRows.Scan(&c.ID, &c.CreatedAt); err == nil {
			cands = append(cands, c)
		}
	}
	candRows.Close()
	frozen := domain.FrozenAccountIDs(cands, a.MaxAccounts)[a.ID]
	if frozen {
		return nil, ErrSyncAccountFrozen
	}
	if strings.ToUpper(a.Provider) == "DANA" && a.Status == "pending" {
		cred, err := s.decryptCredential(a)
		if err != nil {
			return nil, err
		}
		bound, err := s.danaBound(ctx, cred.Phone)
		if err != nil {
			return nil, err
		}
		if !bound {
			return nil, ErrSyncNotBound
		}
	}
	before, _ := s.countMutations(ctx, a.ID)
	if err := s.syncAccount(ctx, a); err != nil {
		return nil, err
	}
	after, _ := s.countMutations(ctx, a.ID)
	// Baca ulang keadaan terbaru (saldo, terakhir sinkron, status).
	var balance int64
	var lastSynced sql.NullTime
	var dbStatus string
	if err := s.store.DB.QueryRowContext(ctx, `SELECT balance_cents, last_synced_at, status
		FROM linked_accounts WHERE id=?`, a.ID).Scan(&balance, &lastSynced, &dbStatus); err != nil {
		return nil, err
	}
	res := &SyncAccountResult{
		AccountID: a.ID, DBStatus: dbStatus, Frozen: frozen,
		BalanceCents: balance, NewMutations: after - before,
	}
	if lastSynced.Valid {
		res.LastSyncedAt = lastSynced.Time
	}
	return res, nil
}

func (s *Syncer) syncAccount(ctx context.Context, a *accountRow) error {
	cred, err := s.decryptCredential(a)
	if err != nil {
		return err
	}
	switch strings.ToUpper(a.Provider) {
	case "DANA":
		return s.syncDANA(ctx, a, cred.Phone)
	case "BCA":
		return s.syncBCA(ctx, a, cred.AccountNo)
	default:
		return fmt.Errorf("unknown provider %q", a.Provider)
	}
}

func (s *Syncer) syncDANA(ctx context.Context, a *accountRow, phone string) error {
	// Akun pending = member belum menyelesaikan otorisasi OAuth DANA.
	// Cek status binding ke Connecta (jaring pengaman bila webhook
	// terlewat); bila belum ter-binding, diam saja — jangan spam
	// ACCOUNT_NOT_FOUND tiap menit.
	if a.Status == "pending" {
		bound, err := s.danaBound(ctx, phone)
		if err != nil || !bound {
			return nil
		}
		// v34: aktivasi self-heal = otorisasi sukses; catat tanggal
		// pertama (COALESCE menjaga bila webhook sudah mencatat).
		_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET status='active', authorized_at=COALESCE(authorized_at, NOW()) WHERE id=?`, a.ID)
		a.Status = "active"
	}
	// Paginasi: ambil halaman demi halaman sampai halaman kosong atau
	// tidak ada baris baru (semuanya sudah ter-dedup); dibatasi maks 10
	// halaman (200 baris) per akun per pass agar tidak jalan tanpa henti.
	newCount := 0
	for page := 1; page <= 10; page++ {
		txs, _, err := s.connecta.DanaTransactions(ctx, phone, page, 20)
		if err != nil {
			return fmt.Errorf("dana transactions: %w", err)
		}
		if len(txs) == 0 {
			break
		}
		pageNew := 0
		for _, tx := range txs {
			date, ok := parseTxDate(tx.Date)
			if !ok {
				s.log.Printf("sync: DANA %s: skip tx tanggal tak ter-parse %q desc=%q", a.PhoneMask.String, tx.Date, tx.Description)
				continue
			}
			hash := MutationHash(a.MemberID, a.ID, a.Provider, date, tx.Type, tx.Amount, tx.Description)
			inserted, err := s.insertMutation(ctx, a, date, tx.Type, tx.Amount, tx.Description, tx.Sender, hash)
			if err != nil {
				return err
			}
			if inserted {
				pageNew++
			}
		}
		newCount += pageNew
		if pageNew == 0 {
			break
		}
	}
	if bal, err := s.connecta.DanaBalance(ctx, phone); err == nil {
		if cents := extractBalanceCents(bal); cents > 0 {
			_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET balance_cents=?, last_synced_at=NOW() WHERE id=?`, cents, a.ID)
		} else {
			_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET last_synced_at=NOW() WHERE id=?`, a.ID)
		}
	} else {
		_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET last_synced_at=NOW() WHERE id=?`, a.ID)
	}
	if newCount > 0 {
		s.log.Printf("sync: DANA %s: %d new mutations", a.PhoneMask.String, newCount)
		if a.CallbackFlag == 1 && a.CallbackURL.Valid && a.CallbackURL.String != "" {
			s.fireCallback(ctx, a, "mutation.new", fmt.Sprintf(`{"provider":"DANA","account_id":%q,"new_mutations":%d}`, a.ID, newCount))
		}
	}
	return nil
}

// filterBCAMutations keeps only rows that belong to this account.
// Rows without any account field pass through (upstream does not
// always tag them); rows tagged with a DIFFERENT account are dropped
// (P2-9). Normalization: digits only, "62" prefix -> "0".
func filterBCAMutations(txs []connecta.BCAMutation, accountNo string) []connecta.BCAMutation {
	want := normalizeAccountNo(accountNo)
	if want == "" {
		return txs
	}
	out := txs[:0]
	for _, tx := range txs {
		if tx.AccountNo == "" {
			out = append(out, tx)
			continue
		}
		if normalizeAccountNo(tx.AccountNo) == want {
			out = append(out, tx)
		}
	}
	return out
}

func normalizeAccountNo(v string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, strings.TrimSpace(v))
	if strings.HasPrefix(digits, "62") {
		return "0" + digits[2:]
	}
	return digits
}

func (s *Syncer) syncBCA(ctx context.Context, a *accountRow, accountNo string) error {
	// P2-9 guard: limit platform adalah 1 akun BCA aktif. Bila ada
	// >1, feed BCA (global, tanpa account_no) tidak bisa dipetakan
	// dengan aman — tolak sinkronisasi BCA dan catat ke audit + log.
	var bcaCount int
	if err := s.store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM linked_accounts
		WHERE provider='BCA' AND status IN ('active','pending')`).Scan(&bcaCount); err == nil && bcaCount > 1 {
		s.log.Printf("sync: BCA guard: %d akun BCA aktif, sinkronisasi BCA ditolak", bcaCount)
		s.store.Audit(ctx, "sync", a.MemberID, "bca_sync_rejected", "lebih dari 1 akun BCA aktif di platform", "")
		return fmt.Errorf("%w: %d akun BCA aktif, tolak sinkronisasi", ErrSyncBCAGuard, bcaCount)
	}
	txs, _, err := s.connecta.BCAMutations(ctx, 25, "")
	if err != nil {
		return fmt.Errorf("bca mutations: %w", err)
	}
	txs = filterBCAMutations(txs, accountNo)
	newCount := 0
	for _, tx := range txs {
		date, ok := parseTxDate(tx.Date)
		if !ok {
			s.log.Printf("sync: BCA %s: skip tx tanggal tak ter-parse %q desc=%q", a.AcctMask.String, tx.Date, tx.Description)
			continue
		}
		hash := MutationHash(a.MemberID, a.ID, a.Provider, date, tx.Type, tx.Amount, tx.Description)
		inserted, err := s.insertMutation(ctx, a, date, tx.Type, tx.Amount, tx.Description, tx.Sender, hash)
		if err != nil {
			return err
		}
		if inserted {
			newCount++
		}
	}
	_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET last_synced_at=NOW() WHERE id=?`, a.ID)
	if newCount > 0 {
		s.log.Printf("sync: BCA %s: %d new mutations", a.AcctMask.String, newCount)
		if a.CallbackFlag == 1 && a.CallbackURL.Valid && a.CallbackURL.String != "" {
			s.fireCallback(ctx, a, "mutation.new", fmt.Sprintf(`{"provider":"BCA","account_id":%q,"new_mutations":%d}`, a.ID, newCount))
		}
	}
	// BCA tidak punya langkah otorisasi lanjutan: sinkronisasi yang
	// berhasil = rekening sudah bisa dibaca, tandai aktif.
	// v34: catat tanggal otorisasi pertama (COALESCE menjaga yang lama).
	if a.Status == "pending" {
		_, _ = s.store.DB.ExecContext(ctx, `UPDATE linked_accounts SET status='active', authorized_at=COALESCE(authorized_at, NOW()) WHERE id=?`, a.ID)
	}
	return nil
}

// danaBound memeriksa apakah nomor DANA sudah ter-binding di Connecta
// (GET /b2b/dana/accounts). Dipakai sebagai jaring pengaman bila webhook
// binding terlewat.
func (s *Syncer) danaBound(ctx context.Context, phone string) (bool, error) {
	raw, err := s.connecta.DanaAccounts(ctx)
	if err != nil {
		return false, err
	}
	var v struct {
		Data []struct {
			Phone     string `json:"phone_number"`
			PhoneAlt  string `json:"phone"`
			AccountID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, err
	}
	for _, d := range v.Data {
		p := d.Phone
		if p == "" {
			p = d.PhoneAlt
		}
		if p == phone {
			return true, nil
		}
	}
	return false, nil
}

func (s *Syncer) insertMutation(ctx context.Context, a *accountRow, date time.Time, typ string, amount int64, desc, sender, hash string) (bool, error) {
	res, err := s.store.DB.ExecContext(ctx, `INSERT IGNORE INTO mutations
		(member_id, linked_account_id, provider, tx_date, type, amount_cents, description, sender, dedup_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.MemberID, a.ID, strings.ToUpper(a.Provider), date, typ, amount, desc, sender, hash)
	if err != nil {
		return false, fmt.Errorf("insert mutation: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// callbackSignature computes the X-MutasiHub-Signature value:
// "sha256=" + hex(HMAC-SHA256(secret, body)) (P2-8).
func callbackSignature(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// ensureCallbackSecret returns the member's callback secret, generating
// and persisting one (32 random bytes, hex) on first use (P2-8).
func (s *Syncer) ensureCallbackSecret(ctx context.Context, memberID string) (string, error) {
	var secret sql.NullString
	err := s.store.DB.QueryRowContext(ctx, `SELECT callback_secret FROM members WHERE id=?`, memberID).Scan(&secret)
	if err != nil {
		return "", err
	}
	if secret.Valid && secret.String != "" {
		return secret.String, nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	gen := hex.EncodeToString(b)
	if _, err := s.store.DB.ExecContext(ctx, `UPDATE members SET callback_secret=?
		WHERE id=? AND (callback_secret IS NULL OR callback_secret='')`, gen, memberID); err != nil {
		return "", err
	}
	return gen, nil
}

// fireCallback delivers one callback (P2-8): signed with HMAC-SHA256
// (header X-MutasiHub-Signature) + X-MutasiHub-Event, retried up to 3
// attempts with backoff (1s, 2s) on transport error or non-2xx, response
// body/status stored for EVERY attempt in the callbacks table (not only
// failures), and a final failure audited. Returns the last attempt's
// HTTP status, response body and error (nil on 2xx) — v42a: TestCallback
// needs them for the member-facing test response. Callers that only fire
// and forget (syncDANA/syncBCA) ignore the returns.
//
// Defense-in-depth (v42a): host target divalidasi ulang sebelum POST —
// DNS bisa berubah setelah URL disimpan member. Bila ditolak: log +
// audit callback_blocked, jangan kirim.
func (s *Syncer) fireCallback(ctx context.Context, a *accountRow, event, payload string) (status int, body string, err error) {
	target := a.CallbackURL.String
	if verr := ValidateCallbackURL(ctx, target); verr != nil {
		s.log.Printf("sync: callback %s ke %s ditolak: %v", event, target, verr)
		s.store.Audit(ctx, "member", a.MemberID, "callback_blocked",
			fmt.Sprintf("event=%s target=%s alasan=%s", event, target, verr), "")
		return 0, "", fmt.Errorf("%w: %s", ErrCallbackURLInvalid, verr)
	}
	secret := ""
	if a.CallbackSecret.Valid && a.CallbackSecret.String != "" {
		secret = a.CallbackSecret.String
	} else if gen, genErr := s.ensureCallbackSecret(ctx, a.MemberID); genErr == nil {
		secret = gen
	} else {
		s.log.Printf("sync: callback secret member=%s tidak bisa disiapkan: %v", a.MemberID, genErr)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastStatus int
	var lastBody string
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(payload))
		if reqErr != nil {
			s.log.Printf("sync: callback build: %v", reqErr)
			return 0, "", reqErr
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-MutasiHub-Event", event)
		if secret != "" {
			req.Header.Set("X-MutasiHub-Signature", callbackSignature(secret, payload))
		}
		resp, doErr := client.Do(req)
		attemptStatus := 0
		attemptBody := ""
		if doErr != nil {
			lastErr = doErr
			attemptBody = doErr.Error()
		} else {
			attemptStatus = resp.StatusCode
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			attemptBody = string(raw)
			if attemptStatus >= 200 && attemptStatus < 300 {
				lastErr = nil
			} else {
				lastErr = fmt.Errorf("callback HTTP %d", attemptStatus)
			}
		}
		lastStatus, lastBody = attemptStatus, attemptBody
		_, _ = s.store.DB.ExecContext(ctx, `INSERT INTO callbacks (member_id, event, payload, target_url, status_code, response_body)
			VALUES (?, ?, ?, ?, ?, ?)`, a.MemberID, event, payload, target, attemptStatus, attemptBody)
		if lastErr == nil {
			return lastStatus, lastBody, nil
		}
		s.log.Printf("sync: callback %s ke %s gagal (percobaan %d/3): %v", event, target, attempt, lastErr)
		if attempt < 3 {
			select {
			case <-ctx.Done():
				return lastStatus, lastBody, lastErr
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}
	}
	s.log.Printf("sync: callback %s ke %s gagal setelah 3 percobaan (status=%d)", event, target, lastStatus)
	s.store.Audit(ctx, "member", a.MemberID, "callback_failed",
		fmt.Sprintf("event=%s target=%s status=%d", event, target, lastStatus), "")
	return lastStatus, lastBody, lastErr
}

// parseTxDate parses an upstream transaction date. RFC3339 (with an
// explicit offset) is honoured as-is; naive layouts carry no zone and
// are read as WIB (Asia/Jakarta, UTC+7) — Connecta dates are local
// wall-clock times. It returns false when no layout matches: callers
// must SKIP the row (and log it), never substitute time.Now() — a
// fabricated tx_date would corrupt history and dedup.
func parseTxDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	wib := time.FixedZone("WIB", 7*3600)
	for _, layout := range []string{
		"2006-01-02 15:04:05", "2006-01-02", "02/01/2006 15:04:05", "02/01/2006",
	} {
		if t, err := time.ParseInLocation(layout, s, wib); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// extractBalanceCents pulls a numeric balance out of a loose JSON payload.
func extractBalanceCents(raw json.RawMessage) int64 {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return 0
	}
	for _, key := range []string{"balance", "saldo", "amount"} {
		if v, ok := m[key]; ok {
			switch n := v.(type) {
			case float64:
				return int64(n * 100)
			case string:
				if f, err := strconv.ParseFloat(strings.ReplaceAll(n, ",", ""), 64); err == nil {
					return int64(f * 100)
				}
			}
		}
	}
	if data, ok := m["data"].(map[string]any); ok {
		if v, ok := data["balance"].(float64); ok {
			return int64(v * 100)
		}
	}
	return 0
}

// Ensure domain import is used (plan helpers are referenced by HTTP layer;
// keep the dependency explicit for future plan-aware sync tuning).
var _ = domain.SubscriptionActive

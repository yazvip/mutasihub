// Package db owns the MySQL connection and schema migrations.
// The server can run without a database (healthz + public plans); every
// handler that needs the DB returns a clear 503 in that mode.
//
// Migrations live in backend/migrations/ and are loaded from disk at
// start (searched relative to the working directory, MIGRATIONS_DIR,
// or the server binary's directory) so the shipped binary + migrations
// folder stay together at deploy time.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Store wraps the database handle; DB may be nil (no-DB mode).
type Store struct {
	DB *sql.DB
}

// Open connects to MySQL using dsn. Callers may pass an empty dsn to
// run in no-DB mode (Open returns a Store with nil DB, nil error).
func Open(dsn string) (*Store, error) {
	if strings.TrimSpace(dsn) == "" {
		return &Store{}, nil
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return &Store{DB: db}, nil
}

// Available reports whether a live database is attached.
func (s *Store) Available() bool { return s != nil && s.DB != nil }

// Close closes the pool, if any.
func (s *Store) Close() error {
	if s == nil || s.DB == nil {
		return nil
	}
	return s.DB.Close()
}

// findMigrationsDir locates backend/migrations/ from several candidates.
func findMigrationsDir() (string, error) {
	candidates := []string{}
	if v := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR")); v != "" {
		candidates = append(candidates, v)
	}
	candidates = append(candidates, "migrations")
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "migrations"))
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "..", "migrations"))
	}
	for _, dir := range candidates {
		if st, err := os.Stat(filepath.Join(dir, "0001_init.sql")); err == nil && !st.IsDir() {
			return dir, nil
		}
	}
	return "", fmt.Errorf("db: migrations directory not found (tried: %s)", strings.Join(candidates, ", "))
}

// Migrate applies SQL migrations in filename order, tracking applied
// versions in schema_migrations. Idempotent: applied files are skipped.
func (s *Store) Migrate(ctx context.Context) error {
	if !s.Available() {
		return nil
	}
	dir, err := findMigrationsDir()
	if err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(64) PRIMARY KEY,
		applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return fmt.Errorf("db: create schema_migrations: %w", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("db: read migrations: %w", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var exists int
		err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version=?`, name).Scan(&exists)
		if err != nil {
			return fmt.Errorf("db: check migration %s: %w", name, err)
		}
		if exists > 0 {
			continue
		}
		root, err := os.OpenRoot(dir)
		if err != nil {
			return fmt.Errorf("db: open migrations root: %w", err)
		}
		defer root.Close()
		f, err := root.Open(name)
		if err != nil {
			return fmt.Errorf("db: read migration %s: %w", name, err)
		}
		raw, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			return fmt.Errorf("db: read migration %s: %w", name, err)
		}
		if _, err := s.DB.ExecContext(ctx, string(raw)); err != nil {
			return fmt.Errorf("db: apply migration %s: %w", name, err)
		}
		if _, err := s.DB.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, name); err != nil {
			return fmt.Errorf("db: record migration %s: %w", name, err)
		}
	}
	return nil
}

// GetSetting reads one settings row; empty string when missing.
func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.DB.QueryRowContext(ctx, `SELECT value FROM settings WHERE setting_key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("db: get setting %s: %w", key, err)
	}
	return v, nil
}

// SetSetting upserts one settings row.
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO settings (setting_key, value) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE value=VALUES(value)`, key, value)
	if err != nil {
		return fmt.Errorf("db: set setting %s: %w", key, err)
	}
	return nil
}

// Audit records an admin / account action.
func (s *Store) Audit(ctx context.Context, actorType, actorID, action, detail, ip string) {
	if !s.Available() {
		return
	}
	// Best effort: audit must never break the request it records.
	_, _ = s.DB.ExecContext(ctx, `INSERT INTO audit_logs (actor_type, actor_id, action, detail, ip)
		VALUES (?, ?, ?, ?, ?)`, actorType, actorID, action, detail, ip)
}

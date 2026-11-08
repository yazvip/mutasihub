// Command server runs the MutasiHub backend API.
//
// The server starts even without a database (MYSQL_DSN empty): /healthz
// answers 200 and DB-backed endpoints return a clear 503. Migrations
// run automatically at start when a database is available.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"mutasi-hub/internal/config"
	"mutasi-hub/internal/db"
	httpx "mutasi-hub/internal/http"
)

func main() {
	cfg := config.Load()
	log.Printf("mutasihub: starting on :%s (db=%v connecta=%v)", cfg.Port, cfg.MySQLDSN != "", cfg.ConnectaBaseURL != "")

	store, err := db.Open(cfg.MySQLDSN)
	if err != nil {
		log.Printf("mutasihub: database unavailable (%v); running in no-DB mode", err)
		store = &db.Store{}
	}
	defer store.Close()

	if store.Available() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := store.Migrate(ctx)
		cancel()
		if err != nil {
			log.Printf("mutasihub: migrations failed: %v", err)
		} else {
			log.Printf("mutasihub: migrations applied")
		}
	}

	srv := httpx.New(cfg, store)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Sync worker: exits when ctx is cancelled.
	go srv.Syncer().Start(ctx)

	httpSrv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("mutasihub: listen: %v", err)
		}
	}()
	log.Printf("mutasihub: listening on :%s", cfg.Port)
	<-ctx.Done()
	log.Printf("mutasihub: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

package main

import (
	"context"
	"embed"
	"log"
	"sort"
	"strings"

	"testing-app/config"
	"testing-app/handler"
	"testing-app/notify"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed db/migrations/*.sql
var migrationFiles embed.FS

func runMigrations(pool *pgxpool.Pool) error {
	ctx := context.Background()

	// Create tracking table
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		return err
	}

	// Read applied migrations
	rows, err := pool.Query(ctx, "SELECT filename FROM schema_migrations")
	if err != nil {
		return err
	}
	applied := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		applied[name] = true
	}
	rows.Close()

	// List migration files sorted
	entries, err := migrationFiles.ReadDir("db/migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".sql") || applied[name] {
			continue
		}

		content, err := migrationFiles.ReadFile("db/migrations/" + name)
		if err != nil {
			return err
		}

		log.Printf("applying migration: %s", name)
		if _, err := pool.Exec(ctx, string(content)); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx,
			"INSERT INTO schema_migrations (filename) VALUES ($1)", name); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("config:", err)
	}

	pool, err := pgxpool.New(context.Background(), cfg.DB.DSN())
	if err != nil {
		log.Fatal("db connect:", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		log.Fatal("db ping:", err)
	}

	if err := runMigrations(pool); err != nil {
		log.Fatal("migrations:", err)
	}

	var sender notify.Sender
	if cfg.TelegramBotToken != "" {
		sender = notify.TelegramSender{BotToken: cfg.TelegramBotToken}
	} else {
		sender = notify.LogSender{}
	}

	r := handler.NewRouter(pool, cfg, sender)
	log.Printf("server starting on %s", cfg.ServerAddr)
	if err := r.Run(cfg.ServerAddr); err != nil {
		log.Fatal("server:", err)
	}
}

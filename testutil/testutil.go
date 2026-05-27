package testutil

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	"testing-app/config"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func Setup(t *testing.T) (*pgxpool.Pool, *config.Config) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	root := findRoot()
	_ = godotenv.Load(filepath.Join(root, ".env"))

	host := getEnv("POSTGRES_HOST", "localhost")
	port, _ := strconv.Atoi(getEnv("POSTGRES_PORT", "5432"))
	user := getEnv("POSTGRES_USER", "postgres")
	pass := getEnv("POSTGRES_PASSWORD", "changeme")

	// Создать тестовую БД если не существует
	adminDSN := fmt.Sprintf("host=%s port=%d dbname=postgres user=%s password=%s sslmode=disable",
		host, port, user, pass)
	adminPool, err := pgxpool.New(context.Background(), adminDSN)
	if err != nil {
		t.Fatal("admin connect:", err)
	}
	_, _ = adminPool.Exec(context.Background(), "CREATE DATABASE testing_app_test")
	adminPool.Close()

	cfg := &config.Config{
		DB: config.DBConfig{
			Host:     host,
			Port:     port,
			Name:     "testing_app_test",
			User:     user,
			Password: pass,
		},
		JWT: config.JWTConfig{
			AccessSecret:  "test_access_secret",
			RefreshSecret: "test_refresh_secret",
			AccessTTL:     15 * time.Minute,
			RefreshTTL:    7 * 24 * time.Hour,
		},
	}

	pool, err := pgxpool.New(context.Background(), cfg.DB.DSN())
	if err != nil {
		t.Fatal("connect test db:", err)
	}

	applyMigrations(t, pool, root)

	t.Cleanup(func() {
		truncate(pool)
		pool.Close()
	})

	return pool, cfg
}

func applyMigrations(t *testing.T, pool *pgxpool.Pool, root string) {
	t.Helper()
	ctx := context.Background()

	_, err := pool.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
	if err != nil {
		t.Fatal("create migrations table:", err)
	}

	files, err := filepath.Glob(filepath.Join(root, "db", "migrations", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatal("no migration files found")
	}
	sort.Strings(files)

	for _, f := range files {
		name := filepath.Base(f)
		var count int
		_ = pool.QueryRow(ctx, "SELECT COUNT(*) FROM _migrations WHERE name=$1", name).Scan(&count)
		if count > 0 {
			continue
		}
		sql, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
		_, _ = pool.Exec(ctx, "INSERT INTO _migrations (name) VALUES ($1)", name)
	}
}

func truncate(pool *pgxpool.Pool) {
	ctx := context.Background()
	tables := []string{"lessons", "user_groups", "ban_log", "sessions", "otp_codes", "groups", "users"}
	for _, tbl := range tables {
		_, _ = pool.Exec(ctx, "TRUNCATE "+tbl+" RESTART IDENTITY CASCADE")
	}
}

// Request выполняет HTTP-запрос к gin-движку и возвращает ResponseRecorder.
func Request(t *testing.T, h http.Handler, method, path, body string, token ...string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = bytes.NewBufferString(body)
	}
	req := httptest.NewRequest(method, path, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if len(token) > 0 && token[0] != "" {
		req.Header.Set("Authorization", "Bearer "+token[0])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// MockSender перехватывает OTP-коды для использования в тестах.
type MockSender struct {
	mu       sync.Mutex
	LastCode string
	LastPhone string
}

func (m *MockSender) SendOTP(_ context.Context, phone string, _ int64, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.LastPhone = phone
	m.LastCode = code
	return nil
}

func (m *MockSender) Code() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.LastCode
}

// findRoot поднимается вверх по директориям пока не найдёт go.mod.
func findRoot() string {
	dir, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "."
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

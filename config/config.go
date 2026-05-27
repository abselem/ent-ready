package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	DB               DBConfig
	JWT              JWTConfig
	ServerAddr       string
	TelegramBotToken string
	CORSOrigins      []string
}

type DBConfig struct {
	URL      string // Railway DATABASE_URL (takes priority)
	Host     string
	Port     int
	Name     string
	User     string
	Password string
}

type JWTConfig struct {
	AccessSecret  string
	RefreshSecret string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	// PORT is set by Railway; SERVER_ADDR overrides if present
	serverAddr := os.Getenv("SERVER_ADDR")
	if serverAddr == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		serverAddr = ":" + port
	}

	// CORS_ORIGINS is a comma-separated list, e.g. "https://app.up.railway.app,http://localhost:3000"
	corsOrigins := os.Getenv("CORS_ORIGINS")
	if corsOrigins == "" {
		corsOrigins = "http://localhost:3000"
	}

	dbPort, _ := strconv.Atoi(getEnv("POSTGRES_PORT", "5432"))

	return &Config{
		DB: DBConfig{
			URL:      os.Getenv("DATABASE_URL"), // Railway injects this automatically
			Host:     getEnv("POSTGRES_HOST", "localhost"),
			Port:     dbPort,
			Name:     getEnv("POSTGRES_DB", ""),
			User:     getEnv("POSTGRES_USER", ""),
			Password: getEnv("POSTGRES_PASSWORD", ""),
		},
		JWT: JWTConfig{
			AccessSecret:  getEnv("JWT_ACCESS_SECRET", "change_me_access"),
			RefreshSecret: getEnv("JWT_REFRESH_SECRET", "change_me_refresh"),
			AccessTTL:     15 * time.Minute,
			RefreshTTL:    7 * 24 * time.Hour,
		},
		ServerAddr:       serverAddr,
		TelegramBotToken: getEnv("TELEGRAM_BOT_TOKEN", ""),
		CORSOrigins:      splitComma(corsOrigins),
	}, nil
}

func (d DBConfig) DSN() string {
	if d.URL != "" {
		return d.URL
	}
	return fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		d.Host, d.Port, d.Name, d.User, d.Password,
	)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitComma(s string) []string {
	var out []string
	for len(s) > 0 {
		i := 0
		for i < len(s) && s[i] != ',' {
			i++
		}
		if part := s[:i]; part != "" {
			out = append(out, part)
		}
		if i < len(s) {
			s = s[i+1:]
		} else {
			break
		}
	}
	return out
}

package config

import (
	"fmt"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AllowLogOTP         bool
	DB                  DBConfig
	JWT                 JWTConfig
	SMTP                SMTPConfig
	Resend              ResendConfig
	Brevo               BrevoConfig
	ServerAddr          string
	TelegramBotToken    string
	TelegramBotUsername string
	TelegramWebhookURL  string
	CORSOrigins         []string
	OTPEnabled          bool
	DemoOTP             bool
}

type SMTPConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
}

type ResendConfig struct {
	APIKey string
	From   string
}

type BrevoConfig struct {
	APIKey    string
	FromEmail string
	FromName  string
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

	accessSecret := os.Getenv("JWT_ACCESS_SECRET")
	if len(accessSecret) < 32 {
		return nil, fmt.Errorf("JWT_ACCESS_SECRET must be set and at least 32 characters (got %d)", len(accessSecret))
	}
	refreshSecret := os.Getenv("JWT_REFRESH_SECRET")
	if len(refreshSecret) < 32 {
		return nil, fmt.Errorf("JWT_REFRESH_SECRET must be set and at least 32 characters (got %d)", len(refreshSecret))
	}

	allowLog := os.Getenv("APP_ENV") == "development" || os.Getenv("APP_ENV") == "test"
	// Temporary pre-launch default, explicitly requested for the test site.
	// Set OTP_DEMO_MODE=false to restore random codes and email delivery.
	demoOTP, err := strconv.ParseBool(getEnv("OTP_DEMO_MODE", "true"))
	if err != nil {
		return nil, fmt.Errorf("OTP_DEMO_MODE must be true or false")
	}
	brevo := BrevoConfig{
		APIKey:    strings.TrimSpace(os.Getenv("BREVO_API_KEY")),
		FromEmail: strings.TrimSpace(os.Getenv("BREVO_FROM_EMAIL")),
		FromName:  getEnv("BREVO_FROM_NAME", "ENT Ready"),
	}
	if !demoOTP && brevo.APIKey != "" {
		address, err := mail.ParseAddress(brevo.FromEmail)
		if err != nil || address.Address != brevo.FromEmail {
			return nil, fmt.Errorf("BREVO_FROM_EMAIL must be a valid sender email address")
		}
	}
	if !demoOTP && !allowLog && brevo.APIKey == "" && os.Getenv("RESEND_API_KEY") == "" && (os.Getenv("SMTP_HOST") == "" || os.Getenv("SMTP_USERNAME") == "") {
		return nil, fmt.Errorf("production requires configured email OTP delivery")
	}
	dbPort, _ := strconv.Atoi(getEnv("POSTGRES_PORT", "5432"))

	return &Config{
		AllowLogOTP: allowLog,
		DemoOTP:     demoOTP,
		Brevo:       brevo,
		DB: DBConfig{
			URL:      os.Getenv("DATABASE_URL"), // Railway injects this automatically
			Host:     getEnv("POSTGRES_HOST", "localhost"),
			Port:     dbPort,
			Name:     getEnv("POSTGRES_DB", ""),
			User:     getEnv("POSTGRES_USER", ""),
			Password: getEnv("POSTGRES_PASSWORD", ""),
		},
		JWT: JWTConfig{
			AccessSecret:  accessSecret,
			RefreshSecret: refreshSecret,
			AccessTTL:     15 * time.Minute,
			RefreshTTL:    7 * 24 * time.Hour,
		},
		SMTP: SMTPConfig{
			Host:     getEnv("SMTP_HOST", ""),
			Port:     getEnv("SMTP_PORT", "587"),
			Username: getEnv("SMTP_USERNAME", ""),
			Password: getEnv("SMTP_PASSWORD", ""),
			From:     getEnv("SMTP_FROM", ""),
		},
		Resend: ResendConfig{
			APIKey: getEnv("RESEND_API_KEY", ""),
			From:   getEnv("RESEND_FROM", "ENT Ready <onboarding@resend.dev>"),
		},
		ServerAddr:          serverAddr,
		TelegramBotToken:    getEnv("TELEGRAM_BOT_TOKEN", ""),
		TelegramBotUsername: getEnv("TELEGRAM_BOT_USERNAME", ""),
		TelegramWebhookURL:  getEnv("TELEGRAM_WEBHOOK_URL", ""),
		CORSOrigins:         splitComma(corsOrigins),
		OTPEnabled:          os.Getenv("OTP_ENABLED") == "true",
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

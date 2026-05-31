package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	db "testing-app/db/sqlc"
	"testing-app/config"
	"testing-app/notify"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// pendingChats maps phone → telegram chat_id for users mid-registration
var pendingChats sync.Map

type TelegramHandler struct {
	q        db.Querier
	pool     *pgxpool.Pool
	cfg      *config.Config
	notifier notify.Sender
}

func NewTelegramHandler(pool *pgxpool.Pool, cfg *config.Config, n notify.Sender) *TelegramHandler {
	return &TelegramHandler{
		q:        db.New(pool),
		pool:     pool,
		cfg:      cfg,
		notifier: n,
	}
}

type tgUpdate struct {
	Message *tgMessage `json:"message"`
}
type tgMessage struct {
	From tgUser `json:"from"`
	Chat tgChat `json:"chat"`
	Text string `json:"text"`
}
type tgUser struct {
	ID int64 `json:"id"`
}
type tgChat struct {
	ID int64 `json:"id"`
}

func (h *TelegramHandler) Webhook(c *gin.Context) {
	var upd tgUpdate
	if err := c.ShouldBindJSON(&upd); err != nil || upd.Message == nil {
		c.Status(http.StatusOK)
		return
	}

	text := strings.TrimSpace(upd.Message.Text)
	chatID := upd.Message.Chat.ID

	if !strings.HasPrefix(text, "/start") {
		c.Status(http.StatusOK)
		return
	}

	parts := strings.SplitN(text, " ", 2)
	if len(parts) < 2 || parts[1] == "" {
		h.sendMessage(chatID, "Привет! Для получения кода перейдите по ссылке с сайта ENT Ready.")
		c.Status(http.StatusOK)
		return
	}

	// Decode base64url(phone:purpose)
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		c.Status(http.StatusOK)
		return
	}

	idx := strings.LastIndex(string(decoded), ":")
	if idx < 0 {
		c.Status(http.StatusOK)
		return
	}
	phone := string(decoded[:idx])
	purpose := string(decoded[idx+1:])
	if purpose != "register" && purpose != "login" && purpose != "reset_password" {
		c.Status(http.StatusOK)
		return
	}

	// Store chatID — used by Register handler to persist it on new users
	pendingChats.Store(phone, chatID)

	// For existing users, persist chatID immediately
	_, _ = h.pool.Exec(context.Background(),
		"UPDATE users SET telegram_chat_id=$1 WHERE phone=$2", chatID, phone)

	// Generate and store OTP
	code := randomOTP()
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		c.Status(http.StatusOK)
		return
	}
	_, err = h.q.CreateOTPCode(context.Background(), db.CreateOTPCodeParams{
		Phone:     phone,
		Code:      string(hash),
		Purpose:   purpose,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(15 * time.Minute), Valid: true},
	})
	if err != nil {
		h.sendMessage(chatID, "Ошибка сервера. Попробуйте ещё раз.")
		c.Status(http.StatusOK)
		return
	}

	_ = h.notifier.SendOTP(c.Request.Context(), phone, chatID, code)
	c.Status(http.StatusOK)
}

// AuthConfig returns feature flags for the frontend.
func (h *TelegramHandler) AuthConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"otp_enabled":  h.cfg.OTPEnabled,
		"bot_username": h.cfg.TelegramBotUsername,
	})
}

func (h *TelegramHandler) sendMessage(chatID int64, text string) {
	if h.cfg.TelegramBotToken == "" {
		return
	}
	body, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": text})
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", h.cfg.TelegramBotToken)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
}

// RegisterWebhook registers the bot webhook with Telegram on startup.
func RegisterWebhook(botToken, webhookURL string) error {
	body, _ := json.Marshal(map[string]string{"url": webhookURL})
	url := fmt.Sprintf("https://api.telegram.org/bot%s/setWebhook", botToken)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram setWebhook status %d", resp.StatusCode)
	}
	return nil
}

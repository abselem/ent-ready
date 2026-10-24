package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"testing-app/config"
	db "testing-app/db/sqlc"
	"testing-app/notify"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
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
	// Legacy phone links do not prove account ownership. Fail closed until
	// authenticated, expiring linking challenges are implemented.
	c.JSON(http.StatusGone, gin.H{"error": "telegram linking disabled; use email authentication"})
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

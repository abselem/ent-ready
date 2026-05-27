package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type Sender interface {
	SendOTP(ctx context.Context, phone string, telegramChatID int64, code string) error
}

// LogSender — только логирует (dev/test)
type LogSender struct{}

func (LogSender) SendOTP(_ context.Context, phone string, chatID int64, code string) error {
	if chatID > 0 {
		log.Printf("[OTP] telegram chat_id=%d code=%s", chatID, code)
	} else {
		log.Printf("[OTP] phone=%s code=%s", phone, code)
	}
	return nil
}

// TelegramSender — шлёт через Telegram Bot API, fallback на лог
type TelegramSender struct {
	BotToken string
}

func (t TelegramSender) SendOTP(ctx context.Context, phone string, chatID int64, code string) error {
	if chatID == 0 {
		log.Printf("[OTP] phone=%s code=%s (no telegram)", phone, code)
		return nil
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.BotToken)
	body, _ := json.Marshal(map[string]any{
		"chat_id": chatID,
		"text":    fmt.Sprintf("Ваш код: %s\n\nНе передавайте его никому.", code),
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram API status %d", resp.StatusCode)
	}
	return nil
}

package notify

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/smtp"
)

type Sender interface {
	SendOTP(ctx context.Context, recipient string, telegramChatID int64, code string) error
}

// LogSender — только логирует (dev/test)
type LogSender struct{}

func (LogSender) SendOTP(_ context.Context, recipient string, chatID int64, code string) error {
	if chatID > 0 {
		log.Printf("[OTP] telegram chat_id=%d code=%s", chatID, code)
	} else {
		log.Printf("[OTP] to=%s code=%s", recipient, code)
	}
	return nil
}

// EmailSender — отправляет OTP на email через SMTP
type EmailSender struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
}

func (e EmailSender) SendOTP(_ context.Context, emailTo string, _ int64, code string) error {
	if e.Host == "" || e.Username == "" {
		log.Printf("[OTP] email=%s code=%s (SMTP not configured)", emailTo, code)
		return nil
	}

	subject := "Ваш код подтверждения — ENT Ready"
	body := fmt.Sprintf(
		"Ваш код подтверждения: %s\r\n\r\nКод действителен 15 минут.\r\nНе передавайте его никому.",
		code,
	)
	msg := fmt.Sprintf(
		"From: ENT Ready <%s>\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		e.From, emailTo, subject, body,
	)

	addr := fmt.Sprintf("%s:%s", e.Host, e.Port)
	auth := smtp.PlainAuth("", e.Username, e.Password, e.Host)

	// Try STARTTLS (port 587)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}

	c, err := smtp.NewClient(conn, e.Host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	if ok, _ := c.Extension("STARTTLS"); ok {
		cfg := &tls.Config{ServerName: e.Host}
		if err = c.StartTLS(cfg); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}

	if err = c.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err = c.Mail(e.From); err != nil {
		return err
	}
	if err = c.Rcpt(emailTo); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err = fmt.Fprint(w, msg); err != nil {
		w.Close()
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// TelegramSender — шлёт через Telegram Bot API, fallback на лог
type TelegramSender struct {
	BotToken string
}

func (t TelegramSender) SendOTP(ctx context.Context, recipient string, chatID int64, code string) error {
	if chatID == 0 {
		log.Printf("[OTP] to=%s code=%s (no telegram)", recipient, code)
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

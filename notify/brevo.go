package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const brevoEndpoint = "https://api.brevo.com/v3/smtp/email"
const brevoTimeout = 15 * time.Second

// BrevoSender delivers email OTPs through Brevo's transactional HTTP API.
// FromEmail must be a verified sender in the Brevo account.
type BrevoSender struct {
	APIKey    string
	FromEmail string
	FromName  string
}

func (b BrevoSender) SendOTP(ctx context.Context, recipient string, _ int64, code string) error {
	return b.sendOTP(ctx, recipient, code, http.DefaultClient, brevoEndpoint)
}

// The endpoint and client are injectable only internally for isolated tests.
func (b BrevoSender) sendOTP(ctx context.Context, recipient, code string, client *http.Client, endpoint string) error {
	if strings.TrimSpace(b.APIKey) == "" || strings.TrimSpace(b.FromEmail) == "" {
		return errors.New("brevo sender not configured")
	}
	payload := struct {
		Sender struct {
			Email string `json:"email"`
			Name  string `json:"name,omitempty"`
		} `json:"sender"`
		To []struct {
			Email string `json:"email"`
		} `json:"to"`
		Subject     string `json:"subject"`
		TextContent string `json:"textContent"`
	}{}
	payload.Sender.Email = b.FromEmail
	payload.Sender.Name = b.FromName
	payload.To = []struct {
		Email string `json:"email"`
	}{{recipient}}
	payload.Subject = "Ваш код подтверждения — ENT Ready"
	payload.TextContent = fmt.Sprintf("Ваш код подтверждения: %s\n\nКод действителен 15 минут. Не передавайте его никому.", code)
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("brevo request encoding failed")
	}
	ctx, cancel := context.WithTimeout(ctx, brevoTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("brevo request creation failed")
	}
	req.Header.Set("api-key", b.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	safeClient := *client
	if safeClient.Timeout <= 0 || safeClient.Timeout > brevoTimeout {
		safeClient.Timeout = brevoTimeout
	}
	safeClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := safeClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("brevo request canceled: %w", ctx.Err())
		}
		return errors.New("brevo request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	// Never include the provider's free-form message or arbitrary code in logs:
	// either can echo an address, API key, or OTP submitted in the request.
	var provider struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&provider)
	switch provider.Code {
	case "invalid_parameter", "missing_parameter", "unauthorized", "permission_denied", "not_enough_credits", "duplicate_parameter", "document_not_found", "method_not_allowed", "out_of_range", "rate_limit_exceeded", "internal_error":
		return fmt.Errorf("brevo API status %d (%s)", resp.StatusCode, provider.Code)
	default:
		return fmt.Errorf("brevo API status %d", resp.StatusCode)
	}
}

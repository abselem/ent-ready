package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testBrevoSender() BrevoSender {
	return BrevoSender{APIKey: "secret-api-key", FromEmail: "sender@example.test", FromName: "ENT Ready"}
}

func TestBrevoPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("api-key") != "secret-api-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("incorrect request headers or method")
		}
		var payload struct {
			Sender               struct{ Email, Name string }
			To                   []struct{ Email string }
			Subject, TextContent string
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload.Sender.Email != "sender@example.test" || payload.Sender.Name != "ENT Ready" || len(payload.To) != 1 || payload.To[0].Email != "student@example.test" || payload.Subject == "" || !strings.Contains(payload.TextContent, "1234") {
			t.Error("incorrect email payload")
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"messageId":"test-id"}`)
	}))
	defer server.Close()
	if err := testBrevoSender().sendOTP(context.Background(), "student@example.test", "1234", server.Client(), server.URL); err != nil {
		t.Fatal(err)
	}
}

func TestBrevoSafeProviderErrors(t *testing.T) {
	for _, status := range []int{401, 429, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				fmt.Fprint(w, `{"code":"unauthorized","message":"secret-api-key 1234 student@example.test"}`)
			}))
			defer server.Close()
			err := testBrevoSender().sendOTP(context.Background(), "student@example.test", "1234", server.Client(), server.URL)
			if err == nil || !strings.Contains(err.Error(), fmt.Sprint(status)) || !strings.Contains(err.Error(), "unauthorized") {
				t.Fatalf("expected status and provider code, got %v", err)
			}
			for _, sensitive := range []string{"secret-api-key", "1234", "student@example.test"} {
				if strings.Contains(err.Error(), sensitive) {
					t.Fatal("provider error leaked sensitive data")
				}
			}
		})
	}
}

func TestBrevoDoesNotEchoUnknownCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"code":"secret-api-key","message":"1234"}`)
	}))
	defer server.Close()
	err := testBrevoSender().sendOTP(context.Background(), "student@example.test", "1234", server.Client(), server.URL)
	if err == nil || err.Error() != "brevo API status 400" {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestBrevoCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- testBrevoSender().sendOTP(ctx, "student@example.test", "1234", server.Client(), server.URL)
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("request did not cancel promptly")
	}
}

func TestBrevoRejectsRedirect(t *testing.T) {
	redirected := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { redirected = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	err := testBrevoSender().sendOTP(context.Background(), "student@example.test", "1234", server.Client(), server.URL)
	if err == nil || redirected {
		t.Fatalf("redirect must not be followed: %v", err)
	}
}

func TestBrevoRequiresConfiguration(t *testing.T) {
	for _, sender := range []BrevoSender{{}, {APIKey: "key"}, {FromEmail: "sender@example.test"}} {
		if err := sender.SendOTP(context.Background(), "student@example.test", 0, "1234"); err == nil {
			t.Error("missing configuration accepted")
		}
	}
}

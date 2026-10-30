package handler_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"testing-app/handler"
	"testing-app/testutil"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

type unavailableDemoSender struct{ calls int }

func (s *unavailableDemoSender) SendOTP(context.Context, string, int64, string) error {
	s.calls++
	return errors.New("test email provider unavailable")
}

func TestDemoOTPRegistrationLoginAndReset(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	cfg.DemoOTP = true
	sender := &unavailableDemoSender{}
	h := handler.NewRouter(pool, cfg, sender)
	email := "demo-lifecycle@example.test"
	registration := fmt.Sprintf(`{"email":%q,"code":"0000","first_name":"Demo","last_name":"Student","password":"SecurePass123","role_id":2}`, email)
	login := fmt.Sprintf(`{"email":%q,"code":"0000"}`, email)
	reset := fmt.Sprintf(`{"email":%q,"code":"0000","password":"NewPassword123"}`, email)
	send := func(purpose string) {
		t.Helper()
		w := testutil.Request(t, h, http.MethodPost, "/api/v1/auth/send-otp", fmt.Sprintf(`{"email":%q,"purpose":%q}`, email, purpose))
		require.Equal(t, 200, w.Code, w.Body.String())
	}

	// The demo code still requires a requested, unexpired code of the right purpose.
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/register", registration).Code)
	send("register")
	var storedHash string
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT code FROM otp_codes WHERE email=$1 AND purpose='register'`, email).Scan(&storedHash))
	require.NotEqual(t, "0000", storedHash)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(storedHash), []byte("0000")))
	require.Equal(t, 201, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/register", registration).Code)
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/register", registration).Code)
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/login/otp", login).Code)

	send("login")
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/reset-password", reset).Code)
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/login/otp", fmt.Sprintf(`{"email":%q,"code":"1234"}`, email)).Code)
	require.Equal(t, 200, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/login/otp", login).Code)
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/login/otp", login).Code)

	// Start a fresh request limiter after the dense negative login checks;
	// keep the same database, configuration and unavailable email provider.
	h = handler.NewRouter(pool, cfg, sender)
	send("reset_password")
	require.Equal(t, 200, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/reset-password", reset).Code)
	require.Equal(t, 400, testutil.Request(t, h, http.MethodPost, "/api/v1/auth/reset-password", reset).Code)
	w := testutil.Request(t, h, http.MethodPost, "/api/v1/auth/login", fmt.Sprintf(`{"identifier":%q,"password":"NewPassword123"}`, email))
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Zero(t, sender.calls, "demo mode must never call the email provider")
}

func TestDemoOTPRejectsExpiredCode(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	cfg.DemoOTP = true
	sender := &unavailableDemoSender{}
	h := handler.NewRouter(pool, cfg, sender)
	w := testutil.Request(t, h, http.MethodPost, "/api/v1/auth/send-otp", `{"email":"demo-expired@example.test","purpose":"register"}`)
	require.Equal(t, 200, w.Code)
	_, err := pool.Exec(context.Background(), `UPDATE otp_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE email='demo-expired@example.test'`)
	require.NoError(t, err)
	w = testutil.Request(t, h, http.MethodPost, "/api/v1/auth/register", `{"email":"demo-expired@example.test","code":"0000","first_name":"Demo","last_name":"Expired","password":"SecurePass123","role_id":2}`)
	require.Equal(t, 400, w.Code)
	require.Zero(t, sender.calls)
}

func TestNormalOTPStillRequiresEmailDelivery(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	cfg.DemoOTP = false
	sender := &unavailableDemoSender{}
	h := handler.NewRouter(pool, cfg, sender)
	w := testutil.Request(t, h, http.MethodPost, "/api/v1/auth/send-otp", `{"email":"normal-provider@example.test","purpose":"register"}`)
	require.Equal(t, 500, w.Code)
	require.Equal(t, 1, sender.calls)
}

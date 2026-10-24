package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"net/http"
	"sync"
	"testing"
	"testing-app/handler"
	"testing-app/testutil"
)

func newRouter(t *testing.T) (http.Handler, *testutil.MockSender) {
	pool, cfg := testutil.Setup(t)
	mock := &testutil.MockSender{}
	return handler.NewRouter(pool, cfg, mock), mock
}

// Keep legacy callers in other suites working while exercising current email auth.
func registerTokens(t *testing.T, h http.Handler, mock *testutil.MockSender, identity string, roleID int) map[string]string {
	t.Helper()
	email := identity + "@example.test"
	w := testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", fmt.Sprintf(`{"email":%q,"purpose":"register"}`, email))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w = testutil.Request(t, h, "POST", "/api/v1/auth/register", fmt.Sprintf(`{"email":%q,"code":%q,"first_name":"Test","last_name":"User","password":"SecurePass123","role_id":%d}`, email, mock.Code(), roleID))
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var tokens map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &tokens))
	return tokens
}

func TestAuthLogoutRevokesAccess(t *testing.T) {
	h, m := newRouter(t)
	tok := registerTokens(t, h, m, "logout", 2)
	require.Equal(t, 200, testutil.Request(t, h, "POST", "/api/v1/auth/logout", "", tok["access_token"]).Code)
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/users/me", "", tok["access_token"]).Code)
	require.Equal(t, 401, testutil.Request(t, h, "POST", "/api/v1/auth/refresh", fmt.Sprintf(`{"refresh_token":%q}`, tok["refresh_token"])).Code)
}

func TestAuthPasswordRequiresReauthentication(t *testing.T) {
	h, m := newRouter(t)
	tok := registerTokens(t, h, m, "password", 2)
	require.Equal(t, 401, testutil.Request(t, h, "PUT", "/api/v1/users/me/password", `{"password":"NewPassword123"}`, tok["access_token"]).Code)
	require.Equal(t, 401, testutil.Request(t, h, "PUT", "/api/v1/users/me/password", `{"password":"NewPassword123","current_password":"wrong"}`, tok["access_token"]).Code)
	require.Equal(t, 200, testutil.Request(t, h, "PUT", "/api/v1/users/me/password", `{"password":"NewPassword123","current_password":"SecurePass123"}`, tok["access_token"]).Code)
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/users/me", "", tok["access_token"]).Code)
}

func TestAuthBannedRefreshAndReset(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	tok := registerTokens(t, h, m, "banned", 2)
	_, err := pool.Exec(context.Background(), `UPDATE users SET is_banned=TRUE WHERE email='banned@example.test'`)
	require.NoError(t, err)
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/users/me", "", tok["access_token"]).Code)
	require.Equal(t, 401, testutil.Request(t, h, "POST", "/api/v1/auth/refresh", fmt.Sprintf(`{"refresh_token":%q}`, tok["refresh_token"])).Code)
	require.Equal(t, 200, testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", `{"email":"banned@example.test","purpose":"reset_password"}`).Code)
	require.Equal(t, 403, testutil.Request(t, h, "POST", "/api/v1/auth/reset-password", fmt.Sprintf(`{"email":"banned@example.test","code":%q,"password":"NewPassword123"}`, m.Code())).Code)
}

func TestAuthRefreshUsesCurrentRole(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	tok := registerTokens(t, h, m, "role", 1)
	_, err := pool.Exec(context.Background(), `UPDATE users SET role_id=2 WHERE email='role@example.test'`)
	require.NoError(t, err)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/refresh", fmt.Sprintf(`{"refresh_token":%q}`, tok["refresh_token"]))
	require.Equal(t, 200, w.Code)
	var next map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &next))
	require.Equal(t, 403, testutil.Request(t, h, "GET", "/api/v1/groups", "", next["access_token"]).Code)
}

func TestAuthConcurrentRefreshSingleUse(t *testing.T) {
	h, m := newRouter(t)
	tok := registerTokens(t, h, m, "refresh", 2)
	var wg sync.WaitGroup
	results := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := testutil.Request(t, h, "POST", "/api/v1/auth/refresh", fmt.Sprintf(`{"refresh_token":%q}`, tok["refresh_token"]))
			results <- w.Code
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for code := range results {
		if code == 200 {
			success++
		} else {
			require.Equal(t, 401, code)
		}
	}
	require.Equal(t, 1, success)
}

func TestAuthConcurrentOTPAttemptLimit(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	registerTokens(t, h, m, "otp", 2)
	require.Equal(t, 200, testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", `{"email":"otp@example.test","purpose":"login"}`).Code)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			testutil.Request(t, h, "POST", "/api/v1/auth/login/otp", `{"email":"otp@example.test","code":"invalid"}`)
		}()
	}
	wg.Wait()
	var attempts int
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT attempts FROM otp_codes WHERE email='otp@example.test' AND purpose='login'`).Scan(&attempts))
	require.Equal(t, 3, attempts)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login/otp", fmt.Sprintf(`{"email":"otp@example.test","code":%q}`, m.Code()))
	require.NotEqual(t, 200, w.Code)
}

func TestAuthLegacyTelegramDisabled(t *testing.T) {
	h, _ := newRouter(t)
	w := testutil.Request(t, h, "POST", "/telegram/webhook", `{"message":{"chat":{"id":1},"text":"/start arbitrary"}}`)
	require.Equal(t, http.StatusGone, w.Code)
}

func TestAuthResetRevokesStolenAccess(t *testing.T) {
	h, m := newRouter(t)
	tok := registerTokens(t, h, m, "reset", 2)
	require.Equal(t, 200, testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", `{"email":"reset@example.test","purpose":"reset_password"}`).Code)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/reset-password", fmt.Sprintf(`{"email":"reset@example.test","code":%q,"password":"NewPassword123"}`, m.Code()))
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/users/me", "", tok["access_token"]).Code)
}

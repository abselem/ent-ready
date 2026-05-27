package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"testing-app/handler"
	"testing-app/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRouter(t *testing.T) (http.Handler, *testutil.MockSender) {
	t.Helper()
	pool, cfg := testutil.Setup(t)
	mock := &testutil.MockSender{}
	return handler.NewRouter(pool, cfg, mock), mock
}

func registerTokens(t *testing.T, h http.Handler, mock *testutil.MockSender, phone string, roleID int) map[string]string {
	t.Helper()
	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		fmt.Sprintf(`{"phone":"%s","purpose":"register"}`, phone))

	body := fmt.Sprintf(`{"phone":"%s","code":"%s","first_name":"Test","last_name":"User","role_id":%d}`,
		phone, mock.Code(), roleID)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/register", body)
	require.Equal(t, http.StatusCreated, w.Code, "register failed: %s", w.Body.String())

	var tokens map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&tokens))
	return tokens
}

// ── register ──────────────────────────────────────────────────────────────────

func TestAuth_Register_OK(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000001", 2)
	assert.NotEmpty(t, tokens["access_token"])
	assert.NotEmpty(t, tokens["refresh_token"])
}

func TestAuth_Register_InvalidOTP(t *testing.T) {
	h, _ := newRouter(t)
	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", `{"phone":"+79991000001","purpose":"register"}`)

	w := testutil.Request(t, h, "POST", "/api/v1/auth/register",
		`{"phone":"+79991000001","code":"000000","first_name":"T","last_name":"T","role_id":2}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAuth_Register_DuplicatePhone(t *testing.T) {
	h, mock := newRouter(t)
	registerTokens(t, h, mock, "+79991000001", 2)

	// Второй запрос на регистрацию с тем же номером
	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp", `{"phone":"+79991000001","purpose":"register"}`)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/register",
		fmt.Sprintf(`{"phone":"+79991000001","code":"%s","first_name":"T","last_name":"T","role_id":2}`, mock.Code()))
	assert.Equal(t, http.StatusConflict, w.Code)
}

// ── login по паролю ───────────────────────────────────────────────────────────

func TestAuth_Login_OK(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000002", 2)

	// Установить пароль
	w := testutil.Request(t, h, "PUT", "/api/v1/users/me/password",
		`{"password":"SecurePass123"}`, tokens["access_token"])
	require.Equal(t, http.StatusOK, w.Code)

	// Логин
	w = testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"phone":"+79991000002","password":"SecurePass123"}`)
	require.Equal(t, http.StatusOK, w.Code)

	var resp map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["access_token"])
}

func TestAuth_Login_WrongPassword(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000002", 2)
	testutil.Request(t, h, "PUT", "/api/v1/users/me/password",
		`{"password":"SecurePass123"}`, tokens["access_token"])

	w := testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"phone":"+79991000002","password":"WrongPass"}`)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuth_Login_NoPassword(t *testing.T) {
	h, mock := newRouter(t)
	registerTokens(t, h, mock, "+79991000002", 2)

	// Пароль не установлен
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"phone":"+79991000002","password":"anything"}`)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ── login по OTP ──────────────────────────────────────────────────────────────

func TestAuth_LoginOTP_OK(t *testing.T) {
	h, mock := newRouter(t)
	registerTokens(t, h, mock, "+79991000003", 2)

	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		`{"phone":"+79991000003","purpose":"login"}`)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login/otp",
		fmt.Sprintf(`{"phone":"+79991000003","code":"%s"}`, mock.Code()))
	require.Equal(t, http.StatusOK, w.Code)

	var resp map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["access_token"])
}

func TestAuth_LoginOTP_TooManyAttempts(t *testing.T) {
	h, _ := newRouter(t)
	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		`{"phone":"+79991000003","purpose":"register"}`)
	testutil.Request(t, h, "POST", "/api/v1/auth/register",
		`{"phone":"+79991000003","code":"000000","first_name":"T","last_name":"T","role_id":2}`)

	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		`{"phone":"+79991000003","purpose":"login"}`)

	// 3 неверных попытки
	for i := 0; i < 3; i++ {
		testutil.Request(t, h, "POST", "/api/v1/auth/login/otp",
			`{"phone":"+79991000003","code":"000000"}`)
	}
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login/otp",
		`{"phone":"+79991000003","code":"000000"}`)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

// ── refresh ───────────────────────────────────────────────────────────────────

func TestAuth_Refresh_OK(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000004", 2)

	w := testutil.Request(t, h, "POST", "/api/v1/auth/refresh",
		fmt.Sprintf(`{"refresh_token":"%s"}`, tokens["refresh_token"]))
	require.Equal(t, http.StatusOK, w.Code)

	var resp map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["access_token"])
	assert.NotEqual(t, tokens["refresh_token"], resp["refresh_token"])
}

func TestAuth_Refresh_Reuse(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000004", 2)

	testutil.Request(t, h, "POST", "/api/v1/auth/refresh",
		fmt.Sprintf(`{"refresh_token":"%s"}`, tokens["refresh_token"]))

	// Повторное использование — должно вернуть 401
	w := testutil.Request(t, h, "POST", "/api/v1/auth/refresh",
		fmt.Sprintf(`{"refresh_token":"%s"}`, tokens["refresh_token"]))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ── logout ────────────────────────────────────────────────────────────────────

func TestAuth_Logout_OK(t *testing.T) {
	h, mock := newRouter(t)
	tokens := registerTokens(t, h, mock, "+79991000005", 2)

	w := testutil.Request(t, h, "POST", "/api/v1/auth/logout", "", tokens["access_token"])
	require.Equal(t, http.StatusOK, w.Code)

	// Refresh после logout должен упасть
	w = testutil.Request(t, h, "POST", "/api/v1/auth/refresh",
		fmt.Sprintf(`{"refresh_token":"%s"}`, tokens["refresh_token"]))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuth_Logout_NoToken(t *testing.T) {
	h, _ := newRouter(t)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/logout", "")
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ── reset password ────────────────────────────────────────────────────────────

func TestAuth_ResetPassword_OK(t *testing.T) {
	h, mock := newRouter(t)
	registerTokens(t, h, mock, "+79991000006", 2)

	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		`{"phone":"+79991000006","purpose":"reset_password"}`)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/reset-password",
		fmt.Sprintf(`{"phone":"+79991000006","code":"%s","password":"NewPass123"}`, mock.Code()))
	require.Equal(t, http.StatusOK, w.Code)

	// Войти с новым паролем
	w = testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"phone":"+79991000006","password":"NewPass123"}`)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAuth_ResetPassword_TooShort(t *testing.T) {
	h, mock := newRouter(t)
	registerTokens(t, h, mock, "+79991000006", 2)

	testutil.Request(t, h, "POST", "/api/v1/auth/send-otp",
		`{"phone":"+79991000006","purpose":"reset_password"}`)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/reset-password",
		fmt.Sprintf(`{"phone":"+79991000006","code":"%s","password":"short"}`, mock.Code()))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

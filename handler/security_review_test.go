package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"testing-app/testutil"

	"github.com/stretchr/testify/require"
)

// Independent regression: the frontend uses POST, and password changes must
// revoke every existing session, not merely the session that submitted it.
func TestSecurityReviewPasswordPOSTRevokesAllSessions(t *testing.T) {
	h, sender := newRouter(t)
	first := registerTokens(t, h, sender, "review-password", 2)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"identifier":"review-password@example.test","password":"SecurePass123"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var second map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &second))

	w = testutil.Request(t, h, "POST", "/api/v1/users/me/password",
		`{"password":"Replacement123","current_password":"SecurePass123"}`, first["access_token"])
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	for _, session := range []map[string]string{first, second} {
		require.Equal(t, http.StatusUnauthorized,
			testutil.Request(t, h, "GET", "/api/v1/users/me", "", session["access_token"]).Code)
		require.Equal(t, http.StatusUnauthorized,
			testutil.Request(t, h, "POST", "/api/v1/auth/refresh",
				fmt.Sprintf(`{"refresh_token":%q}`, session["refresh_token"])).Code)
	}
	w = testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"identifier":"review-password@example.test","password":"Replacement123"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

func TestSecurityReviewLogoutPreservesOtherSession(t *testing.T) {
	h, sender := newRouter(t)
	first := registerTokens(t, h, sender, "review-logout", 2)
	w := testutil.Request(t, h, "POST", "/api/v1/auth/login",
		`{"identifier":"review-logout@example.test","password":"SecurePass123"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var second map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &second))
	require.Equal(t, http.StatusOK,
		testutil.Request(t, h, "POST", "/api/v1/auth/logout", "", first["access_token"]).Code)
	require.Equal(t, http.StatusUnauthorized,
		testutil.Request(t, h, "GET", "/api/v1/users/me", "", first["access_token"]).Code)
	w = testutil.Request(t, h, "GET", "/api/v1/users/me", "", second["access_token"])
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

package handler_test

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
	"testing-app/testutil"
)

func TestSecurityGroupAndLessonIsolation(t *testing.T) {
	h, sender := newRouter(t)
	teacher := registerTokens(t, h, sender, "isolation-teacher", 1)["access_token"]
	student := registerTokens(t, h, sender, "isolation-student", 2)["access_token"]
	other := registerTokens(t, h, sender, "isolation-other", 2)["access_token"]
	for _, request := range []struct{ method, body string }{{"GET", ""}, {"PUT", `{"first_name":"Safe","last_name":"Profile"}`}} {
		w := testutil.Request(t, h, request.method, "/api/v1/users/me", request.body, student)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.NotContains(t, w.Body.String(), "password_hash")
		require.NotContains(t, w.Body.String(), "telegram_chat_id")
	}
	w := testutil.Request(t, h, "POST", "/api/v1/groups", `{"name":"Isolation","city":"Test","school":"Test"}`, teacher)
	require.Equal(t, 201, w.Code, w.Body.String())
	var group map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &group))
	gid := int(group["id"].(float64))
	for _, path := range []string{fmt.Sprintf("/api/v1/groups/%d", gid), fmt.Sprintf("/api/v1/groups/%d/students", gid), fmt.Sprintf("/api/v1/groups/%d/lessons", gid)} {
		require.Equal(t, 404, testutil.Request(t, h, "GET", path, "", other).Code, path)
	}
	w = testutil.Request(t, h, "POST", "/api/v1/groups/join", fmt.Sprintf(`{"invite_code":%q}`, group["invite_code"]), student)
	require.Equal(t, 201, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "invite_code")
	w = testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/groups/%d", gid), "", student)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "invite_code")
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/groups/%d/students", gid), "", student).Code)
	w = testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/groups/%d/students", gid), "", teacher)
	require.Equal(t, 200, w.Code, w.Body.String())
	for _, key := range []string{"password_hash", "telegram_chat_id", "phone", "email"} {
		require.NotContains(t, w.Body.String(), key)
	}

	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/groups/%d/lessons", gid), `{"title":"Hidden lesson","visibility":"private"}`, teacher)
	require.Equal(t, 201, w.Code, w.Body.String())
	var lesson map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &lesson))
	lid := int(lesson["id"].(float64))
	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), `{"type":"text","content":"confidential material"}`, teacher)
	require.Equal(t, 201, w.Code, w.Body.String())
	for _, suffix := range []string{"", "/blocks", "/view"} {
		method := "GET"
		if suffix == "/view" {
			method = "POST"
		}
		require.Equal(t, 404, testutil.Request(t, h, method, fmt.Sprintf("/api/v1/lessons/%d%s", lid, suffix), "", student).Code)
	}
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", teacher).Code)
	require.Equal(t, 200, testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/lessons/%d/publish", lid), `{"visibility":"private"}`, teacher).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", student).Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", other).Code)
	w = testutil.Request(t, h, "GET", "/api/v1/users/me", "", other)
	var me map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &me))
	otherID := int(me["id"].(float64))
	require.Equal(t, 204, testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/lessons/%d/access", lid), fmt.Sprintf(`{"type":"student","ref_id":%d}`, otherID), teacher).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", other).Code)
	require.Equal(t, 204, testutil.Request(t, h, "DELETE", fmt.Sprintf("/api/v1/lessons/%d/access/student/%d", lid, otherID), "", teacher).Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", other).Code)
	require.Equal(t, 204, testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/lessons/%d/unpublish", lid), "", teacher).Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", lid), "", student).Code)
	require.Equal(t, http.StatusNotFound, testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/groups/%d/lessons", gid), `{"title":"forged"}`, registerTokens(t, h, sender, "other-teacher", 1)["access_token"]).Code)
}

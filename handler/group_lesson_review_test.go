package handler_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"testing-app/testutil"

	"github.com/stretchr/testify/require"
)

// Verify allowed catalogue paths as well as denial: public publication,
// individual grant, group grant, revocation, and foreign-teacher drafts.
func TestSecurityReviewLessonPublicationAndGrants(t *testing.T) {
	h, sender := newRouter(t)
	owner := registerTokens(t, h, sender, "review-lesson-owner", 1)["access_token"]
	foreignTeacher := registerTokens(t, h, sender, "review-lesson-teacher", 1)["access_token"]
	individual := registerTokens(t, h, sender, "review-lesson-individual", 2)["access_token"]
	member := registerTokens(t, h, sender, "review-lesson-member", 2)["access_token"]
	outsider := registerTokens(t, h, sender, "review-lesson-outsider", 2)["access_token"]
	decodeID := func(body []byte) int {
		var item map[string]any
		require.NoError(t, json.Unmarshal(body, &item))
		return int(item["id"].(float64))
	}
	w := testutil.Request(t, h, "GET", "/api/v1/users/me", "", individual)
	require.Equal(t, 200, w.Code)
	individualID := decodeID(w.Body.Bytes())
	w = testutil.Request(t, h, "POST", "/api/v1/groups", `{"name":"Review grant","city":"Test","school":"Test"}`, owner)
	require.Equal(t, 201, w.Code, w.Body.String())
	groupID := decodeID(w.Body.Bytes())
	var group map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &group))
	w = testutil.Request(t, h, "POST", "/api/v1/groups/join", fmt.Sprintf(`{"invite_code":%q}`, group["invite_code"]), member)
	require.Equal(t, 201, w.Code, w.Body.String())

	w = testutil.Request(t, h, "POST", "/api/v1/lessons", `{"title":"Review standalone","visibility":"all"}`, owner)
	require.Equal(t, 201, w.Code, w.Body.String())
	lessonID := decodeID(w.Body.Bytes())
	path := fmt.Sprintf("/api/v1/lessons/%d", lessonID)
	require.Equal(t, 201, testutil.Request(t, h, "POST", path+"/blocks", `{"type":"text","content":"review content"}`, owner).Code)
	checkRead := func(token string, allowed bool) {
		t.Helper()
		status := 404
		if allowed {
			status = 200
		}
		for _, suffix := range []string{"", "/blocks", "/view"} {
			method := "GET"
			if suffix == "/view" {
				method = "POST"
			}
			result := testutil.Request(t, h, method, path+suffix, "", token)
			expected := status
			if allowed && suffix == "/view" {
				expected = 204
			}
			require.Equal(t, expected, result.Code, result.Body.String())
		}
		result := testutil.Request(t, h, "GET", "/api/v1/lessons/available", "", token)
		require.Equal(t, 200, result.Code, result.Body.String())
		var items []struct {
			ID int `json:"id"`
		}
		require.NoError(t, json.Unmarshal(result.Body.Bytes(), &items))
		found := false
		for _, item := range items {
			if item.ID == lessonID {
				found = true
			}
		}
		require.Equal(t, allowed, found, "catalogue and direct read must agree")
	}
	checkRead(owner, true)
	checkRead(foreignTeacher, false)
	checkRead(outsider, false)
	require.Equal(t, 200, testutil.Request(t, h, "POST", path+"/publish", `{"visibility":"all"}`, owner).Code)
	checkRead(outsider, true)
	checkRead(foreignTeacher, true)
	require.Equal(t, 200, testutil.Request(t, h, "POST", path+"/publish", `{"visibility":"private"}`, owner).Code)
	checkRead(individual, false)
	checkRead(member, false) // Membership alone cannot read a standalone private lesson.
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/access", fmt.Sprintf(`{"type":"student","ref_id":%d}`, individualID), owner).Code)
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/access", fmt.Sprintf(`{"type":"group","ref_id":%d}`, groupID), owner).Code)
	checkRead(individual, true)
	checkRead(member, true)
	checkRead(outsider, false)
	require.Equal(t, 204, testutil.Request(t, h, "DELETE", fmt.Sprintf("%s/access/group/%d", path, groupID), "", owner).Code)
	checkRead(member, false)
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/unpublish", "", owner).Code)
	checkRead(individual, false) // An explicit grant cannot expose an unpublished draft.
	checkRead(foreignTeacher, false)
	checkRead(owner, true)
}

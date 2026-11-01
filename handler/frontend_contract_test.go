package handler_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"testing-app/testutil"

	"github.com/stretchr/testify/require"
)

func TestQuestionMetadataEditPreservesScoreAndOrder(t *testing.T) {
	h, sender := newRouter(t)
	owner := registerTokens(t, h, sender, "metadata-owner", 1)["access_token"]
	other := registerTokens(t, h, sender, "metadata-other", 1)["access_token"]
	w := testutil.Request(t, h, "POST", "/api/v1/questions", `{"text":"Original","points":3,"difficulty":2}`, owner)
	require.Equal(t, 201, w.Code, w.Body.String())
	var question map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &question))
	path := fmt.Sprintf("/api/v1/questions/%d", int(question["id"].(float64)))
	w = testutil.Request(t, h, "PUT", path, `{"text":"Original","points":3,"order_num":7,"difficulty":2}`, owner)
	require.Equal(t, 200, w.Code, w.Body.String())

	// This is the actual metadata form payload: score/order are not provided.
	w = testutil.Request(t, h, "PUT", path, `{"text":"Edited metadata","difficulty":3,"allow_generation":true,"explanation":"Explanation"}`, owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &question))
	require.Equal(t, float64(3), question["points"])
	require.Equal(t, float64(7), question["order_num"])
	require.Equal(t, "Edited metadata", question["text"])
	require.Equal(t, true, question["allow_generation"])

	// Explicit edits, including order zero, must still work.
	w = testutil.Request(t, h, "PUT", path, `{"text":"Explicit score","points":5,"order_num":0,"difficulty":2}`, owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &question))
	require.Equal(t, float64(5), question["points"])
	require.Equal(t, float64(0), question["order_num"])
	require.Equal(t, 404, testutil.Request(t, h, "PUT", path, `{"text":"Forbidden"}`, other).Code)
}

func TestLessonViewersIncludeEmailOnlyStudents(t *testing.T) {
	h, sender := newRouter(t)
	owner := registerTokens(t, h, sender, "viewers-owner", 1)["access_token"]
	student := registerTokens(t, h, sender, "viewers-email-student", 2)["access_token"]
	w := testutil.Request(t, h, "POST", "/api/v1/lessons", `{"title":"Public viewed lesson","visibility":"all"}`, owner)
	require.Equal(t, 201, w.Code, w.Body.String())
	var lesson map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &lesson))
	path := fmt.Sprintf("/api/v1/lessons/%d", int(lesson["id"].(float64)))
	require.Equal(t, 200, testutil.Request(t, h, "POST", path+"/publish", `{"visibility":"all"}`, owner).Code)
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/view", "", student).Code)
	w = testutil.Request(t, h, "GET", path+"/viewers", "", owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	var viewers []map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &viewers))
	require.Len(t, viewers, 1)
	require.Equal(t, "Test", viewers[0]["first_name"])
	require.Equal(t, "", viewers[0]["phone"])
	require.NotEmpty(t, viewers[0]["viewed_at"])
	require.Equal(t, 403, testutil.Request(t, h, "GET", path+"/viewers", "", student).Code)
}

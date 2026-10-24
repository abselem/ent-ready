package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
	"testing-app/handler"
	"testing-app/testutil"
)

func TestTestAccessSecurity(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	owner := registerTokens(t, h, m, "test-owner", 1)["access_token"]
	stranger := registerTokens(t, h, m, "test-stranger", 1)["access_token"]
	student := registerTokens(t, h, m, "test-student", 2)["access_token"]
	ctx := context.Background()
	var ownerID, studentID int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='test-owner@example.test'`).Scan(&ownerID))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='test-student@example.test'`).Scan(&studentID))
	var testID, questionID, optionID int32
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO tests(title,created_by,is_public,max_attempts) VALUES('private',$1,FALSE,10) RETURNING id`, ownerID).Scan(&testID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO questions(text,owner_id) VALUES('secret',$1) RETURNING id`, ownerID).Scan(&questionID))
	_, err := pool.Exec(ctx, `INSERT INTO test_questions(test_id,question_id) VALUES($1,$2)`, testID, questionID)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO answer_options(question_id,text,is_correct) VALUES($1,'correct',TRUE) RETURNING id`, questionID).Scan(&optionID))
	path := fmt.Sprintf("/api/v1/tests/%d", testID)
	require.Equal(t, 404, testutil.Request(t, h, "GET", path, "", student).Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", path, "", stranger).Code)
	w := testutil.Request(t, h, "GET", path, "", owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"is_correct":true`)
	_, err = pool.Exec(ctx, `UPDATE tests SET is_published=TRUE,is_public=TRUE WHERE id=$1`, testID)
	require.NoError(t, err)
	for _, token := range []string{student, stranger} {
		w = testutil.Request(t, h, "GET", path, "", token)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.NotContains(t, w.Body.String(), `is_correct`)
	}
	// Private generated tests remain personal even if someone accidentally marks them public.
	_, err = pool.Exec(ctx, `UPDATE tests SET generated_for=$2 WHERE id=$1`, testID, studentID)
	require.NoError(t, err)
	require.Equal(t, 404, testutil.Request(t, h, "GET", path, "", stranger).Code)
	w = testutil.Request(t, h, "POST", path+"/attempts", "", student)
	require.Equal(t, 201, w.Code, w.Body.String())
	var started struct {
		AttemptID int32 `json:"attempt_id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &started))
	answerPath := fmt.Sprintf("/api/v1/attempts/%d/answer", started.AttemptID)
	require.Equal(t, 400, testutil.Request(t, h, "POST", answerPath, fmt.Sprintf(`{"question_id":%d,"option_id":%d}`, questionID, optionID+100000), student).Code)
	require.Equal(t, 200, testutil.Request(t, h, "POST", answerPath, fmt.Sprintf(`{"question_id":%d,"option_id":%d}`, questionID, optionID), student).Code)
	_, err = pool.Exec(ctx, `UPDATE tests SET time_limit=1 WHERE id=$1;`, testID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE test_attempts SET started_at=NOW()-INTERVAL '2 minutes' WHERE id=$1`, started.AttemptID)
	require.NoError(t, err)
	require.Equal(t, 403, testutil.Request(t, h, "POST", answerPath, fmt.Sprintf(`{"question_id":%d,"option_id":%d}`, questionID, optionID), student).Code)
	finishPath := fmt.Sprintf("/api/v1/attempts/%d/finish", started.AttemptID)
	require.Equal(t, 200, testutil.Request(t, h, "POST", finishPath, "", student).Code)
	require.Equal(t, 200, testutil.Request(t, h, "POST", finishPath, "", student).Code)
	_, err = pool.Exec(ctx, `UPDATE tests SET deadline=NOW()-INTERVAL '1 minute' WHERE id=$1`, testID)
	require.NoError(t, err)
	require.Equal(t, 403, testutil.Request(t, h, "POST", path+"/attempts", "", student).Code)
	// Linking someone else's bank question into an owned test must not disclose its key.
	w = testutil.Request(t, h, "POST", "/api/v1/tests", `{"title":"own"}`, stranger)
	require.Equal(t, 201, w.Code, w.Body.String())
	var own struct {
		ID int32 `json:"id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &own))
	require.Equal(t, 404, testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/tests/%d/questions/link", own.ID), fmt.Sprintf(`{"question_id":%d}`, questionID), stranger).Code)
}

func TestTestAccessSecurityGenerationOptIn(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	owner := registerTokens(t, h, m, "bank-owner", 1)["access_token"]
	student := registerTokens(t, h, m, "bank-student", 2)["access_token"]
	var topicID int32
	require.NoError(t, pool.QueryRow(context.Background(), `INSERT INTO topics(name) VALUES('Generation test') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`).Scan(&topicID))
	w := testutil.Request(t, h, "POST", "/api/v1/questions", fmt.Sprintf(`{"text":"private bank","topic_id":%d,"options":[{"text":"answer","is_correct":true}]}`, topicID), owner)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var q struct {
		ID      int32 `json:"id"`
		Allowed bool  `json:"allow_generation"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &q))
	require.False(t, q.Allowed)
	randomPath := fmt.Sprintf("/api/v1/topics/%d/random-test", topicID)
	require.Equal(t, 400, testutil.Request(t, h, "POST", randomPath, "", student).Code)
	w = testutil.Request(t, h, "PUT", fmt.Sprintf("/api/v1/questions/%d", q.ID), fmt.Sprintf(`{"text":"private bank","topic_id":%d,"allow_generation":true}`, topicID), owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"allow_generation":true`)
	w = testutil.Request(t, h, "POST", randomPath, "", student)
	require.Equal(t, 201, w.Code, w.Body.String())
	var result struct {
		TestID int32 `json:"test_id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	var public bool
	var creator *int32
	var generatedFor int32
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT is_public,created_by,generated_for FROM tests WHERE id=$1`, result.TestID).Scan(&public, &creator, &generatedFor))
	require.False(t, public)
	require.Nil(t, creator)
	require.NotZero(t, generatedFor)
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/tests/%d", result.TestID), "", owner).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/tests/%d", result.TestID), "", student).Code)
}

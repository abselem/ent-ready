package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"testing-app/handler"
	"testing-app/testutil"
)

func TestQASchoolPreservesRosterHistoryAndProtectsAssets(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	ctx := context.Background()
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	teacher := registerTokens(t, h, m, "qa.teacher.20261101", 1)["access_token"]
	student := registerTokens(t, h, m, "qa.student.20261101", 2)["access_token"]
	retained := registerTokens(t, h, m, "qa_existing_roster", 2)["access_token"]
	outsider := registerTokens(t, h, m, "qa_outsider", 2)["access_token"]
	ordinaryTeacher := registerTokens(t, h, m, "qa_ordinary_teacher", 1)["access_token"]
	var tid, sid, rid, oid, gid, lid, testID, qid, optionID, attemptID int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.teacher.20261101@example.test'`).Scan(&tid))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.student.20261101@example.test'`).Scan(&sid))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa_existing_roster@example.test'`).Scan(&rid))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa_ordinary_teacher@example.test'`).Scan(&oid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO groups(name,city,school,teacher_id,invite_code,category) VALUES('QA 01.11','fixture','fixture',$1,'QA3611','school') RETURNING id`, tid).Scan(&gid))
	_, err := pool.Exec(ctx, `INSERT INTO user_groups(user_id,group_id) VALUES($1,$3),($2,$3)`, sid, rid, gid)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO lessons(title,created_by,visibility,is_published) VALUES('QA lesson',$1,'private',TRUE) RETURNING id`, tid).Scan(&lid))
	_, err = pool.Exec(ctx, `INSERT INTO lesson_blocks(lesson_id,type,content) VALUES($1,'image','https://old.invalid/image.png')`, lid)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO topics(id,name) VALUES(1,'QA fixture subject') ON CONFLICT DO NOTHING`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE lessons SET topic_id=1 WHERE id=$1`, lid)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO tests(title,created_by,group_id,is_published,max_attempts) VALUES('QA test',$1,$2,TRUE,3) RETURNING id`, tid, gid).Scan(&testID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO questions(test_id,owner_id,text,points) VALUES($1,$2,'QA private question',1) RETURNING id`, testID, tid).Scan(&qid))
	_, err = pool.Exec(ctx, `INSERT INTO test_questions(test_id,question_id) VALUES($1,$2)`, testID, qid)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO answer_options(question_id,text,is_correct) VALUES($1,'right',TRUE) RETURNING id`, qid).Scan(&optionID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO test_attempts(test_id,user_id,finished_at,score,max_score) VALUES($1,$2,NOW(),1,1) RETURNING id`, testID, rid).Scan(&attemptID))
	_, err = pool.Exec(ctx, `INSERT INTO student_answers(attempt_id,question_id,option_id) VALUES($1,$2,$3)`, attemptID, qid, optionID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO lesson_views(lesson_id,user_id) VALUES($1,$2),($1,$3)`, lid, sid, rid)
	require.NoError(t, err)
	var ordinaryID int32
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO lessons(title,created_by,visibility,is_published) VALUES('ordinary catalogue',$1,'all',TRUE) RETURNING id`, oid).Scan(&ordinaryID))
	var provisioned bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&provisioned))
	require.True(t, provisioned)
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&provisioned))
	require.True(t, provisioned)
	var orgID, storedGroup, views, score, answers int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT organization_id FROM qa_workspace_registry`).Scan(&orgID))
	require.NoError(t, pool.QueryRow(ctx, `SELECT group_id FROM lessons WHERE id=$1`, lid).Scan(&storedGroup))
	require.Equal(t, gid, storedGroup)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM lesson_views WHERE lesson_id=$1`, lid).Scan(&views))
	require.EqualValues(t, 2, views)
	require.NoError(t, pool.QueryRow(ctx, `SELECT score FROM test_attempts WHERE id=$1`, attemptID).Scan(&score))
	require.EqualValues(t, 1, score)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM student_answers WHERE attempt_id=$1`, attemptID).Scan(&answers))
	require.EqualValues(t, 1, answers)
	var marker string
	require.NoError(t, pool.QueryRow(ctx, `SELECT content FROM lesson_blocks WHERE lesson_id=$1`, lid).Scan(&marker))
	require.Equal(t, "qa-asset://subject/1", marker)
	var body map[string]any
	w := testutil.Request(t, h, "GET", "/api/v1/qa/context", "", teacher)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, true, body["active"])
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", lid), "", student).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", lid), "", retained).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", ordinaryID), "", retained).Code, "retained ordinary account keeps catalogue")
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", ordinaryID), "", student).Code, "dedicated QA is confined")
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", lid), "", outsider).Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/tests/%d", testID), "", outsider).Code)
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/1", "").Code)
	require.Equal(t, 404, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/1", "", outsider).Code)
	for i := 1; i <= 14; i++ {
		w = testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/qa/assets/subject/%d", i), "", student)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "image/png", w.Header().Get("Content-Type"))
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.True(t, bytesHavePNGHeader(w.Body.Bytes()))
	}
	require.Equal(t, 200, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/1", "", retained).Code)
	for _, payload := range []string{`{"title":"escape","is_public":true}`, `{"title":"escape","group_id":999}`, `{"title":"escape","visibility":"all"}`} {
		require.Equal(t, 403, testutil.Request(t, h, "POST", "/api/v1/lessons", payload, teacher).Code)
	}
	w = testutil.Request(t, h, "POST", "/api/v1/lessons", `{"title":"QA new draft"}`, teacher)
	require.Equal(t, 201, w.Code, w.Body.String())
	var created struct {
		GroupID int32 `json:"group_id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	require.Equal(t, gid, created.GroupID)
	require.Equal(t, 403, testutil.Request(t, h, "POST", "/api/v1/ent/start", `{}`, student).Code)
	require.Equal(t, 403, testutil.Request(t, h, "POST", "/api/v1/topics/1/random-test", `{}`, student).Code)
	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/tests/%d/attempts", testID), `{}`, student)
	require.Equal(t, 201, w.Code, w.Body.String())
	var attempt struct {
		ID int32 `json:"attempt_id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &attempt))
	require.NotContains(t, w.Body.String(), `"is_correct"`)
	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/attempts/%d/answer", attempt.ID), fmt.Sprintf(`{"question_id":%d,"option_id":%d}`, qid, optionID), student)
	require.Equal(t, 200, w.Code, w.Body.String())
	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/attempts/%d/finish", attempt.ID), `{}`, student)
	require.Equal(t, 200, w.Code, w.Body.String())
	_, err = pool.Exec(ctx, `UPDATE questions SET generation_allowed=TRUE WHERE id=$1`, qid)
	require.Error(t, err, "DB invariant forbids public generation")
	_, err = pool.Exec(ctx, `ALTER TABLE questions DISABLE TRIGGER qa_questions_boundary`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `ALTER TABLE questions ENABLE TRIGGER qa_questions_boundary`)
	})
	_, err = pool.Exec(ctx, `UPDATE questions SET generation_allowed=TRUE,topic_id=1 WHERE id=$1`, qid)
	require.NoError(t, err)
	w = testutil.Request(t, h, "POST", "/api/v1/topics/1/random-test", `{}`, ordinaryTeacher)
	require.Equal(t, 400, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "QA private question")
	_, err = pool.Exec(ctx, `ALTER TABLE questions ENABLE TRIGGER qa_questions_boundary`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE organization_members SET status='inactive' WHERE organization_id=$1 AND user_id=$2`, orgID, sid)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&provisioned))
	require.Equal(t, 403, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", lid), "", student).Code)
	require.Equal(t, 403, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/1", "", student).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", "/api/v1/qa/context", "", student).Code)
	require.Equal(t, 200, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/lessons/%d", ordinaryID), "", ordinaryTeacher).Code)
}

func bytesHavePNGHeader(data []byte) bool {
	return len(data) > 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n"
}

func TestQASchoolProvisionNoopAndForeignGraphRollback(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	ctx := context.Background()
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	var ready bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&ready))
	require.False(t, ready)
	registerTokens(t, h, m, "qa.teacher.20261101", 1)
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&ready))
	require.False(t, ready)
	registerTokens(t, h, m, "qa.student.20261101", 2)
	registerTokens(t, h, m, "qa_foreign_author", 1)
	var teacherID, foreignID, testID int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.teacher.20261101@example.test'`).Scan(&teacherID))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa_foreign_author@example.test'`).Scan(&foreignID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO tests(title,created_by) VALUES('QA conflict',$1) RETURNING id`, teacherID).Scan(&testID))
	_, err := pool.Exec(ctx, `INSERT INTO questions(test_id,owner_id,text) VALUES($1,$2,'foreign private content')`, testID, foreignID)
	require.NoError(t, err)
	err = pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&ready)
	require.Error(t, err)
	var orgs, bindings int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM qa_workspace_registry`).Scan(&orgs))
	require.Zero(t, orgs)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM qa_workspace_accounts`).Scan(&bindings))
	require.Zero(t, bindings)
	var author int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT owner_id FROM questions WHERE test_id=$1`, testID).Scan(&author))
	require.Equal(t, foreignID, author)
}

func TestQASchoolDoesNotOverwriteExistingOrganization(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	ctx := context.Background()
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	teacher := registerTokens(t, h, m, "qa.teacher.20261101", 1)["access_token"]
	registerTokens(t, h, m, "qa.student.20261101", 2)
	org := createAcceptanceOrg(t, h, teacher, `{"name":"Existing organization"}`)
	var teacherID, groupID int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.teacher.20261101@example.test'`).Scan(&teacherID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO groups(name,city,school,teacher_id,invite_code,organization_id) VALUES('QA 01.11','qa','existing',$1,'QA7631',$2) RETURNING id`, teacherID, org.ID).Scan(&groupID))
	var ready bool
	require.Error(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&ready))
	var actual int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT organization_id FROM groups WHERE id=$1`, groupID).Scan(&actual))
	require.Equal(t, org.ID, actual)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM qa_workspace_registry`).Scan(&count))
	require.Zero(t, count)
}

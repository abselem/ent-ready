package handler_test

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"testing"

	"github.com/stretchr/testify/require"
	"testing-app/handler"
	"testing-app/testutil"
)

// Independent route matrix: denial must coexist with permitted QA editing.
func TestQASchoolIndependentRouteBoundaries(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	ctx := context.Background()
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	teacher := registerTokens(t, h, m, "qa.teacher.20261101", 1)["access_token"]
	student := registerTokens(t, h, m, "qa.student.20261101", 2)["access_token"]
	outsider := registerTokens(t, h, m, "qa_matrix_outsider", 2)["access_token"]
	foreignTeacher := registerTokens(t, h, m, "qa_matrix_teacher", 1)["access_token"]
	var tid, sid, oid, gid, lid, bid, testID, qid, optionID, attemptID, foreignGroup int32
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.teacher.20261101@example.test'`).Scan(&tid))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa.student.20261101@example.test'`).Scan(&sid))
	require.NoError(t, pool.QueryRow(ctx, `SELECT id FROM users WHERE email='qa_matrix_outsider@example.test'`).Scan(&oid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO lessons(title,created_by,is_published) VALUES('QA matrix',$1,TRUE) RETURNING id`, tid).Scan(&lid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO lesson_blocks(lesson_id,type,content) VALUES($1,'text','private body') RETURNING id`, lid).Scan(&bid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO tests(title,created_by,is_published) VALUES('QA matrix',$1,TRUE) RETURNING id`, tid).Scan(&testID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO questions(test_id,owner_id,text) VALUES($1,$2,'private question') RETURNING id`, testID, tid).Scan(&qid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO test_questions(test_id,question_id) VALUES($1,$2) RETURNING question_id`, testID, qid).Scan(&qid))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO answer_options(question_id,text,is_correct) VALUES($1,'private correct',TRUE) RETURNING id`, qid).Scan(&optionID))
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO test_attempts(test_id,user_id,finished_at,score,max_score) VALUES($1,$2,NOW(),0,1) RETURNING id`, testID, sid).Scan(&attemptID))
	var ready bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT provision_qa_school()`).Scan(&ready))
	require.True(t, ready)
	require.NoError(t, pool.QueryRow(ctx, `SELECT default_group_id FROM qa_workspace_registry`).Scan(&gid))
	var invite string
	require.NoError(t, pool.QueryRow(ctx, `SELECT invite_code FROM groups WHERE id=$1`, gid).Scan(&invite))
	require.Equal(t, 404, testutil.Request(t, h, "POST", "/api/v1/groups/join", fmt.Sprintf(`{"invite_code":%q}`, invite), outsider).Code)
	for i := 1; i <= 14; i++ {
		w := testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/qa/assets/subject/%d", i), "", student)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
		img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
		require.NoError(t, err)
		require.Positive(t, img.Bounds().Dx())
		require.Positive(t, img.Bounds().Dy())
	}
	require.Equal(t, 404, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/15", "", student).Code)
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO groups(name,city,school,teacher_id,invite_code,category) SELECT 'foreign','fixture','fixture',id,'FQM123','school' FROM users WHERE email='qa_matrix_teacher@example.test' RETURNING id`).Scan(&foreignGroup))
	for _, tc := range []struct {
		method, path, body, token string
		want                      int
	}{
		{"GET", fmt.Sprintf("/api/v1/lessons/%d/blocks", lid), "", outsider, 404},
		{"PUT", fmt.Sprintf("/api/v1/lesson-blocks/%d", bid), `{"content":"stolen"}`, foreignTeacher, 404},
		{"PUT", fmt.Sprintf("/api/v1/questions/%d", qid), `{"text":"stolen"}`, foreignTeacher, 404},
		{"PUT", fmt.Sprintf("/api/v1/options/%d", optionID), `{"text":"stolen"}`, foreignTeacher, 404},
		{"GET", fmt.Sprintf("/api/v1/attempts/%d/review", attemptID), "", outsider, 404},
		{"POST", fmt.Sprintf("/api/v1/attempts/%d/finish", attemptID), `{}`, outsider, 404},
		{"POST", "/api/v1/groups/join", `{"invite_code":"FQM123"}`, student, 404},
		{"POST", fmt.Sprintf("/api/v1/groups/%d/students", gid), fmt.Sprintf(`{"user_id":%d}`, oid), teacher, 403},
		{"POST", fmt.Sprintf("/api/v1/lessons/%d/access", lid), fmt.Sprintf(`{"type":"student","ref_id":%d}`, oid), teacher, 403},
		{"POST", fmt.Sprintf("/api/v1/lessons/%d/access", lid), fmt.Sprintf(`{"type":"group","ref_id":%d}`, foreignGroup), teacher, 403},
		{"POST", fmt.Sprintf("/api/v1/lessons/%d/access", lid), fmt.Sprintf(`{"type":"student","ref_id":%d}`, sid), teacher, 204},
		{"POST", fmt.Sprintf("/api/v1/lessons/%d/publish", lid), `{"visibility":"all"}`, teacher, 403},
		{"POST", fmt.Sprintf("/api/v1/lessons/%d/publish", lid), `{"visibility":"private"}`, teacher, 200},
		{"PUT", fmt.Sprintf("/api/v1/tests/%d", testID), `{"title":"escape","is_public":true}`, teacher, 403},
		{"GET", fmt.Sprintf("/api/v1/attempts/%d/review", attemptID), "", student, 200},
	} {
		t.Run(tc.method+tc.path+fmt.Sprint(tc.want), func(t *testing.T) {
			w := testutil.Request(t, h, tc.method, tc.path, tc.body, tc.token)
			require.Equal(t, tc.want, w.Code, w.Body.String())
		})
	}
	_, err := pool.Exec(ctx, `UPDATE organization_members SET role='teacher' WHERE user_id=$1`, sid)
	require.NoError(t, err)
	w := testutil.Request(t, h, "GET", "/api/v1/qa/context", "", student)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"active":false`)
	require.Equal(t, 403, testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/tests/%d", testID), "", student).Code)
	require.Equal(t, 403, testutil.Request(t, h, "GET", "/api/v1/qa/assets/subject/1", "", student).Code)
}

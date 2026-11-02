package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"testing-app/handler"
	"testing-app/testutil"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

type transferAcceptanceFixture struct {
	pool                               *pgxpool.Pool
	h                                  http.Handler
	owner, other, student              string
	ownerID, otherID, studentID, orgID int32
}

func newTransferAcceptanceFixture(t *testing.T) transferAcceptanceFixture {
	t.Helper()
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	f := transferAcceptanceFixture{pool: pool, h: h}
	f.owner = registerTokens(t, h, m, "transfer_accept_owner", 1)["access_token"]
	f.other = registerTokens(t, h, m, "transfer_accept_other", 1)["access_token"]
	f.student = registerTokens(t, h, m, "transfer_accept_student", 2)["access_token"]
	for email, target := range map[string]*int32{"transfer_accept_owner@example.test": &f.ownerID, "transfer_accept_other@example.test": &f.otherID, "transfer_accept_student@example.test": &f.studentID} {
		require.NoError(t, pool.QueryRow(context.Background(), `SELECT id FROM users WHERE email=$1`, email).Scan(target))
	}
	f.orgID = createAcceptanceOrg(t, h, f.owner, `{"name":"Transfer QA"}`).ID
	return f
}

func (f transferAcceptanceFixture) endpoint(suffix string) string {
	return fmt.Sprintf("/api/v1/organizations/%d/transfers/%s", f.orgID, suffix)
}

func transferFixtureID(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int32 {
	t.Helper()
	var id int32
	require.NoError(t, pool.QueryRow(context.Background(), query, args...).Scan(&id))
	return id
}

func transferFixtureExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	_, err := pool.Exec(context.Background(), query, args...)
	require.NoError(t, err)
}

type transferAcceptanceReport struct {
	ExecutionAllowed bool           `json:"execution_allowed"`
	TenantReady      bool           `json:"tenant_enforcement_ready"`
	AsOf             string         `json:"as_of"`
	Counts           map[string]int `json:"counts"`
	Blockers         []struct {
		Code  string `json:"code"`
		Count int    `json:"count"`
	} `json:"blockers"`
}

func (f transferAcceptanceFixture) preflight(t *testing.T, kind string, id int32) transferAcceptanceReport {
	t.Helper()
	w := testutil.Request(t, f.h, "POST", f.endpoint("preflight"), fmt.Sprintf(`{"resource_type":%q,"resource_id":%d}`, kind, id), f.owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	var result transferAcceptanceReport
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.False(t, result.ExecutionAllowed)
	require.False(t, result.TenantReady)
	require.NotEmpty(t, result.AsOf)
	return result
}

func TestTransferAcceptanceAuthorizationAndCandidates(t *testing.T) {
	f := newTransferAcceptanceFixture(t)
	for _, suffix := range []string{"candidates", "preflight"} {
		method, body := "GET", ""
		if suffix == "preflight" {
			method, body = "POST", `{"resource_type":"group","resource_id":1}`
		}
		require.Equal(t, 401, testutil.Request(t, f.h, method, f.endpoint(suffix), body).Code)
		require.Equal(t, 404, testutil.Request(t, f.h, method, f.endpoint(suffix), body, f.other).Code)
	}
	w := testutil.Request(t, f.h, "GET", f.endpoint("candidates"), "", f.owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.JSONEq(t, `{"groups":[],"lessons":[],"tests":[],"has_more":{"groups":false,"lessons":false,"tests":false}}`, w.Body.String())
	transferFixtureExec(t, f.pool, `INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'teacher')`, f.orgID, f.studentID)
	for _, role := range []string{"teacher", "student", "parent", "admin"} {
		transferFixtureExec(t, f.pool, `UPDATE organization_members SET role=$1 WHERE organization_id=$2 AND user_id=$3`, role, f.orgID, f.studentID)
		expected := 403
		if role == "admin" {
			expected = 200
		}
		w = testutil.Request(t, f.h, "GET", f.endpoint("candidates"), "", f.student)
		require.Equal(t, expected, w.Code, "role=%s body=%s", role, w.Body.String())
		if expected == 403 {
			require.Equal(t, 403, testutil.Request(t, f.h, "POST", f.endpoint("preflight"), `{"resource_type":"group","resource_id":1}`, f.student).Code)
		}
	}
	transferFixtureExec(t, f.pool, `UPDATE organization_members SET status='inactive' WHERE organization_id=$1 AND user_id=$2`, f.orgID, f.studentID)
	require.Equal(t, 404, testutil.Request(t, f.h, "GET", f.endpoint("candidates"), "", f.student).Code)
	require.Equal(t, 404, testutil.Request(t, f.h, "POST", f.endpoint("preflight"), `{"resource_type":"group","resource_id":1}`, f.student).Code)
	transferFixtureExec(t, f.pool, `INSERT INTO groups(name,city,school,teacher_id) SELECT 'QA-'||n,'QA','QA',$1 FROM generate_series(1,101) n`, f.ownerID)
	transferFixtureExec(t, f.pool, `INSERT INTO lessons(title,created_by) SELECT 'Own lesson '||n,$1 FROM generate_series(1,102) n`, f.ownerID)
	transferFixtureExec(t, f.pool, `INSERT INTO tests(title,created_by) VALUES('Own test',$1)`, f.ownerID)
	transferFixtureExec(t, f.pool, `INSERT INTO groups(name,city,school,teacher_id) VALUES('Foreign secret','Foreign city','Foreign school',$1)`, f.otherID)
	transferFixtureExec(t, f.pool, `INSERT INTO lessons(title,created_by,visibility,is_published) VALUES('Foreign secret lesson',$1,'all',TRUE)`, f.otherID)
	transferFixtureExec(t, f.pool, `INSERT INTO tests(title,created_by,is_public,is_published) VALUES('Foreign secret test',$1,TRUE,TRUE)`, f.otherID)
	w = testutil.Request(t, f.h, "GET", f.endpoint("candidates"), "", f.owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "Foreign")
	var response struct {
		Groups, Lessons, Tests []struct {
			ID    int32  `json:"id"`
			Title string `json:"title"`
		}
		HasMore map[string]bool `json:"has_more"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	require.Len(t, response.Groups, 100)
	require.Len(t, response.Lessons, 100)
	require.Len(t, response.Tests, 1)
	require.True(t, response.HasMore["groups"])
	require.True(t, response.HasMore["lessons"])
	require.False(t, response.HasMore["tests"])
	for i := 1; i < len(response.Groups); i++ {
		require.Greater(t, response.Groups[i-1].ID, response.Groups[i].ID)
	}
	for i := 1; i < len(response.Lessons); i++ {
		require.Greater(t, response.Lessons[i-1].ID, response.Lessons[i].ID)
	}
}

func TestTransferAcceptanceValidationAndRootOwnership(t *testing.T) {
	f := newTransferAcceptanceFixture(t)
	for _, body := range []string{
		`{}`, `null`, `[]`, `{"resource_type":"group","resource_id":0}`, `{"resource_type":"group","resource_id":-1}`,
		`{"resource_type":"unknown","resource_id":1}`, `{"resource_type":null,"resource_id":1}`, `{"resource_type":"group","resource_id":null}`,
		`{"resource_type":"group","resource_id":"1"}`, `{"resource_type":"group","resource_id":1.5}`, `{"resource_type":"group","resource_id":2147483648}`,
		`{"resource_type":"group","resource_id":1,"user_id":1}`, `{"resource_type":"group","resource_id":1} {}`,
		fmt.Sprintf(`{"resource_type":"group","resource_id":1,"extra":%q}`, strings.Repeat("x", 4096)),
	} {
		w := testutil.Request(t, f.h, "POST", f.endpoint("preflight"), body, f.owner)
		require.Equal(t, 400, w.Code, "input=%s body=%s", body, w.Body.String())
	}
	for _, id := range []string{"0", "-1", "abc", "2147483648"} {
		require.Equal(t, 400, testutil.Request(t, f.h, "GET", "/api/v1/organizations/"+id+"/transfers/candidates", "", f.owner).Code)
	}
	queries := map[string]string{
		"group":  `INSERT INTO groups(name,city,school,teacher_id) VALUES('FOREIGN_ROOT','QA','QA',$1) RETURNING id`,
		"lesson": `INSERT INTO lessons(title,created_by,visibility,is_published) VALUES('FOREIGN_ROOT',$1,'all',TRUE) RETURNING id`,
		"test":   `INSERT INTO tests(title,created_by,is_public,is_published) VALUES('FOREIGN_ROOT',$1,TRUE,TRUE) RETURNING id`,
	}
	for kind, query := range queries {
		foreignID := transferFixtureID(t, f.pool, query, f.otherID)
		for _, id := range []int32{foreignID, 2147483647} {
			w := testutil.Request(t, f.h, "POST", f.endpoint("preflight"), fmt.Sprintf(`{"resource_type":%q,"resource_id":%d}`, kind, id), f.owner)
			require.Equal(t, 404, w.Code, w.Body.String())
			require.NotContains(t, w.Body.String(), "counts")
			require.NotContains(t, w.Body.String(), "FOREIGN_ROOT")
		}
	}
	lessonID := transferFixtureID(t, f.pool, `INSERT INTO lessons(title,created_by) VALUES('Empty own lesson',$1) RETURNING id`, f.ownerID)
	report := f.preflight(t, "lesson", lessonID)
	require.Equal(t, map[string]int{"groups": 0, "lessons": 1, "tests": 0, "questions": 0, "contexts": 0}, report.Counts)
	for _, blocker := range report.Blockers {
		require.NotEqual(t, "requires_group_bundle", blocker.Code)
	}
}

func TestTransferAcceptanceDependencyGraphAndNoWrites(t *testing.T) {
	f := newTransferAcceptanceFixture(t)
	g := transferFixtureID(t, f.pool, `INSERT INTO groups(name,city,school,teacher_id) VALUES('Own bundle','QA','QA',$1) RETURNING id`, f.ownerID)
	foreignG := transferFixtureID(t, f.pool, `INSERT INTO groups(name,city,school,teacher_id) VALUES('FOREIGN_GROUP','QA','QA',$1) RETURNING id`, f.otherID)
	l := transferFixtureID(t, f.pool, `INSERT INTO lessons(title,created_by,group_id,visibility,is_published) VALUES('Own lesson',$1,$2,'all',TRUE) RETURNING id`, f.ownerID, g)
	transferFixtureExec(t, f.pool, `INSERT INTO lessons(title,created_by,group_id) VALUES('FOREIGN_LESSON',$1,$2)`, f.otherID, g)
	transferFixtureExec(t, f.pool, `INSERT INTO lessons(title,group_id) VALUES('UNOWNED_LESSON',$1)`, g)
	testID := transferFixtureID(t, f.pool, `INSERT INTO tests(title,created_by,group_id,is_public,is_published) VALUES('Own test',$1,$2,TRUE,TRUE) RETURNING id`, f.ownerID, g)
	foreignTest := transferFixtureID(t, f.pool, `INSERT INTO tests(title,created_by,group_id) VALUES('FOREIGN_TEST',$1,$2) RETURNING id`, f.otherID, foreignG)
	ctx := transferFixtureID(t, f.pool, `INSERT INTO question_contexts(body,created_by) VALUES('Own context',$1) RETURNING id`, f.ownerID)
	foreignCtx := transferFixtureID(t, f.pool, `INSERT INTO question_contexts(body,created_by) VALUES('FOREIGN_CONTEXT_BODY',$1) RETURNING id`, f.otherID)
	q1 := transferFixtureID(t, f.pool, `INSERT INTO questions(text,owner_id,test_id,context_id,generation_allowed) VALUES('Own legacy question',$1,$2,$3,TRUE) RETURNING id`, f.ownerID, testID, ctx)
	q2 := transferFixtureID(t, f.pool, `INSERT INTO questions(text,owner_id,context_id) VALUES('Own junction question',$1,$2) RETURNING id`, f.ownerID, foreignCtx)
	transferFixtureExec(t, f.pool, `UPDATE questions SET test_id=$1 WHERE id=$2`, foreignTest, q2)
	q3 := transferFixtureID(t, f.pool, `INSERT INTO questions(text,owner_id,test_id) VALUES('Own duplicate-linked question',$1,$2) RETURNING id`, f.ownerID, testID)
	foreignQ := transferFixtureID(t, f.pool, `INSERT INTO questions(text,owner_id,test_id) VALUES('FOREIGN_QUESTION_BODY',$1,$2) RETURNING id`, f.otherID, testID)
	transferFixtureExec(t, f.pool, `INSERT INTO questions(text,test_id) VALUES('UNOWNED_QUESTION',$1)`, testID)
	transferFixtureExec(t, f.pool, `INSERT INTO test_questions(test_id,question_id) VALUES($1,$2),($1,$3),($1,$4),($5,$6)`, testID, q2, q3, foreignQ, foreignTest, q1)
	transferFixtureExec(t, f.pool, `INSERT INTO questions(text,owner_id,test_id,context_id) VALUES('FOREIGN_CONTEXT_CHILD',$1,$2,$3)`, f.otherID, foreignTest, ctx)
	transferFixtureExec(t, f.pool, `INSERT INTO lesson_blocks(lesson_id,type,content) VALUES($1,'image','https://example.invalid/qa.png')`, l)
	transferFixtureExec(t, f.pool, `INSERT INTO lesson_views(lesson_id,user_id) VALUES($1,$2)`, l, f.studentID)
	transferFixtureExec(t, f.pool, `INSERT INTO lesson_access(lesson_id,type,ref_id) VALUES($1,'group',$2),($1,'student',$3)`, l, foreignG, f.studentID)
	transferFixtureExec(t, f.pool, `INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)`, f.studentID, g)
	transferFixtureExec(t, f.pool, `INSERT INTO test_attempts(test_id,user_id) VALUES($1,$2)`, testID, f.studentID)
	entAttempt := transferFixtureID(t, f.pool, `INSERT INTO ent_attempts(user_id) VALUES($1) RETURNING id`, f.studentID)
	transferFixtureExec(t, f.pool, `INSERT INTO ent_attempt_questions(attempt_id,question_id,slot,order_num) VALUES($1,$2,1,0)`, entAttempt, q1)
	snapshot := func() string {
		var value string
		require.NoError(t, f.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
		 'groups',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM groups t),
		 'lessons',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM lessons t),
		 'tests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tests t),
		 'questions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM questions t),
		 'members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY organization_id,user_id) FROM organization_members t),
		 'access',(SELECT jsonb_agg(to_jsonb(t) ORDER BY lesson_id,type,ref_id) FROM lesson_access t),
		 'attempts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM test_attempts t),
		 'views',(SELECT jsonb_agg(to_jsonb(t) ORDER BY lesson_id,user_id) FROM lesson_views t))::text`).Scan(&value))
		return value
	}
	before := snapshot()
	w := testutil.Request(t, f.h, "POST", f.endpoint("preflight"), fmt.Sprintf(`{"resource_type":"group","resource_id":%d}`, g), f.owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	var report transferAcceptanceReport
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &report))
	require.Equal(t, map[string]int{"groups": 1, "lessons": 1, "tests": 1, "questions": 3, "contexts": 1}, report.Counts)
	require.False(t, report.ExecutionAllowed)
	require.False(t, report.TenantReady)
	require.NotContains(t, w.Body.String(), "FOREIGN_")
	require.NotContains(t, w.Body.String(), "@example.test")
	codes := map[string]int{}
	for _, blocker := range report.Blockers {
		codes[blocker.Code] = blocker.Count
	}
	for _, code := range []string{"foreign_owned_content", "public_catalogue", "test_attempts", "lesson_views", "ent_history", "shared_questions", "generation_enabled", "shared_contexts", "missing_memberships", "external_access", "media_storage"} {
		require.Positive(t, codes[code], "missing blocker %s: %s", code, w.Body.String())
	}
	require.Equal(t, 2, codes["shared_questions"], "both junction and legacy test_id outside the closure need detection")
	for _, root := range []struct {
		kind string
		id   int32
	}{{"lesson", l}, {"test", testID}} {
		r := f.preflight(t, root.kind, root.id)
		found := false
		for _, blocker := range r.Blockers {
			if blocker.Code == "requires_group_bundle" {
				found = true
			}
		}
		require.True(t, found, "group-attached %s needs group bundle", root.kind)
	}
	_ = f.preflight(t, "group", g)
	require.Equal(t, before, snapshot(), "preflight must not mutate resources, access, memberships or history")
}

func TestTransferAcceptanceExplanationImageRequiresMediaReview(t *testing.T) {
	f := newTransferAcceptanceFixture(t)
	testID := transferFixtureID(t, f.pool, `INSERT INTO tests(title,created_by) VALUES('Image explanation test',$1) RETURNING id`, f.ownerID)
	transferFixtureExec(t, f.pool, `INSERT INTO questions(text,owner_id,test_id,explanation_image_url) VALUES('Image only in explanation',$1,$2,'https://example.invalid/explanation.png')`, f.ownerID, testID)
	report := f.preflight(t, "test", testID)
	found := false
	for _, blocker := range report.Blockers {
		if blocker.Code == "media_storage" {
			require.Positive(t, blocker.Count)
			found = true
		}
	}
	require.True(t, found, "explanation images require storage and permission review too")
}

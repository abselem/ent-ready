package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"testing-app/handler"
	"testing-app/testutil"

	"github.com/stretchr/testify/require"
)

type orgAcceptanceSummary struct {
	ID       int32  `json:"id"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
	Locale   string `json:"locale"`
	Scale    string `json:"grading_scale"`
	Role     string `json:"role"`
}

func createAcceptanceOrg(t *testing.T, h http.Handler, token, body string) orgAcceptanceSummary {
	t.Helper()
	w := testutil.Request(t, h, "POST", "/api/v1/organizations", body, token)
	require.Equal(t, 201, w.Code, w.Body.String())
	var org orgAcceptanceSummary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &org))
	require.Positive(t, org.ID)
	return org
}

func TestOrganizationsAcceptanceCreationAndIsolation(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	owner := registerTokens(t, h, m, "org_accept_owner", 1)["access_token"]
	other := registerTokens(t, h, m, "org_accept_other", 1)["access_token"]
	student := registerTokens(t, h, m, "org_accept_student", 2)["access_token"]
	require.Equal(t, 401, testutil.Request(t, h, "GET", "/api/v1/organizations", "").Code)
	w := testutil.Request(t, h, "GET", "/api/v1/organizations", "", other)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.JSONEq(t, `[]`, w.Body.String())
	org := createAcceptanceOrg(t, h, owner, `{"name":"  Школа QA  "}`)
	require.Equal(t, "Школа QA", org.Name)
	require.Equal(t, "Asia/Qyzylorda", org.Timezone)
	require.Equal(t, "ru", org.Locale)
	require.Equal(t, "points", org.Scale)
	require.Equal(t, "owner", org.Role)
	second := createAcceptanceOrg(t, h, owner, `{"name":"Школа QA"}`)
	require.NotEqual(t, org.ID, second.ID, "duplicate names are allowed")
	require.Equal(t, 403, testutil.Request(t, h, "POST", "/api/v1/organizations", `{"name":"Student school"}`, student).Code)
	path := fmt.Sprintf("/api/v1/organizations/%d", org.ID)
	for _, token := range []string{other, student} {
		for _, request := range []struct{ method, suffix, body string }{
			{"GET", "", ""}, {"PATCH", "", `{"name":"Hijack"}`}, {"GET", "/members", ""},
		} {
			w = testutil.Request(t, h, request.method, path+request.suffix, request.body, token)
			require.Equal(t, 404, w.Code, w.Body.String())
			require.NotContains(t, w.Body.String(), org.Name)
		}
	}
	w = testutil.Request(t, h, "GET", "/api/v1/organizations", "", owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	var listed []orgAcceptanceSummary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &listed))
	require.Len(t, listed, 2)
	w = testutil.Request(t, h, "GET", "/api/v1/organizations", "", other)
	require.Equal(t, 200, w.Code)
	require.JSONEq(t, `[]`, w.Body.String())
	var roleID, memberCount int
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT role_id FROM users WHERE email='org_accept_owner@example.test'`).Scan(&roleID))
	require.Equal(t, 1, roleID)
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT count(*) FROM organization_members WHERE organization_id=$1 AND role='owner' AND status='active'`, org.ID).Scan(&memberCount))
	require.Equal(t, 1, memberCount)
	w = testutil.Request(t, h, "GET", path+"/members", "", owner)
	require.Equal(t, 200, w.Code, w.Body.String())
	var members []map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &members))
	require.Len(t, members, 1)
	require.Equal(t, "owner", members[0]["role"])
	for _, field := range []string{"email", "phone", "role_id", "password_hash", "session_id"} {
		require.NotContains(t, members[0], field)
	}
}

func TestOrganizationsAcceptanceScopedRolesAndRevocation(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	owner := registerTokens(t, h, m, "org_accept_roles_owner", 1)["access_token"]
	member := registerTokens(t, h, m, "org_accept_roles_member", 2)["access_token"]
	org := createAcceptanceOrg(t, h, owner, `{"name":"Role fixture"}`)
	path := fmt.Sprintf("/api/v1/organizations/%d", org.ID)
	_, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id,user_id,role,status) SELECT $1,id,'teacher','active' FROM users WHERE email='org_accept_roles_member@example.test'`, org.ID)
	require.NoError(t, err)
	for _, role := range []string{"teacher", "student", "parent", "admin"} {
		_, err = pool.Exec(context.Background(), `UPDATE organization_members SET role=$1 WHERE organization_id=$2 AND user_id=(SELECT id FROM users WHERE email='org_accept_roles_member@example.test')`, role, org.ID)
		require.NoError(t, err)
		w := testutil.Request(t, h, "GET", path, "", member)
		require.Equal(t, 200, w.Code, w.Body.String())
		var detail orgAcceptanceSummary
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &detail))
		require.Equal(t, role, detail.Role, "use organization role, not global user role")
		expected := 403
		if role == "admin" {
			expected = 200
		}
		w = testutil.Request(t, h, "PATCH", path, `{"locale":"kk"}`, member)
		require.Equal(t, expected, w.Code, w.Body.String())
		require.Equal(t, expected, testutil.Request(t, h, "GET", path+"/members", "", member).Code)
	}
	_, err = pool.Exec(context.Background(), `UPDATE organization_members SET status='inactive' WHERE organization_id=$1 AND user_id=(SELECT id FROM users WHERE email='org_accept_roles_member@example.test')`, org.ID)
	require.NoError(t, err)
	for _, suffix := range []string{"", "/members"} {
		require.Equal(t, 404, testutil.Request(t, h, "GET", path+suffix, "", member).Code)
	}
	require.Equal(t, 404, testutil.Request(t, h, "PATCH", path, `{"name":"Inactive"}`, member).Code)
	w := testutil.Request(t, h, "GET", "/api/v1/organizations", "", member)
	require.Equal(t, 200, w.Code)
	require.JSONEq(t, `[]`, w.Body.String())
}

func TestOrganizationsAcceptanceValidationAndPartialPatch(t *testing.T) {
	h, m := newRouter(t)
	token := registerTokens(t, h, m, "org_accept_validation", 1)["access_token"]
	for _, body := range []string{
		`{}`, `{"name":null}`, `{"name":"   "}`, `{"name":12}`,
		`{"name":"School","timezone":"Unknown/Zone"}`, `{"name":"School","locale":"en"}`,
		`{"name":"School","grading_scale":"12"}`, `{"name":"School","locale":null}`,
		`{"name":"School","timezone":null}`, `{"name":"School","grading_scale":null}`,
		fmt.Sprintf(`{"name":%q}`, strings.Repeat("Я", 121)),
	} {
		w := testutil.Request(t, h, "POST", "/api/v1/organizations", body, token)
		require.Equal(t, 400, w.Code, "body=%s response=%s", body, w.Body.String())
	}
	org := createAcceptanceOrg(t, h, token, `{"name":"Original","timezone":"UTC","locale":"kk","grading_scale":"10"}`)
	path := fmt.Sprintf("/api/v1/organizations/%d", org.ID)
	for _, body := range []string{`{}`, `{"name":null}`, `{"locale":null}`, `{"timezone":null}`, `{"grading_scale":null}`, `{"name":""}`, `{"locale":"en"}`, `{"timezone":"Wrong/Zone"}`, `{"grading_scale":"0"}`} {
		w := testutil.Request(t, h, "PATCH", path, body, token)
		require.Equal(t, 400, w.Code, "body=%s response=%s", body, w.Body.String())
	}
	w := testutil.Request(t, h, "PATCH", path, `{"name":"  Renamed  "}`, token)
	require.Equal(t, 200, w.Code, w.Body.String())
	var changed orgAcceptanceSummary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &changed))
	require.Equal(t, "Renamed", changed.Name)
	require.Equal(t, org.Timezone, changed.Timezone)
	require.Equal(t, org.Locale, changed.Locale)
	require.Equal(t, org.Scale, changed.Scale)
	for _, id := range []string{"0", "-1", "abc", "999999999999999999999999"} {
		require.Equal(t, 400, testutil.Request(t, h, "GET", "/api/v1/organizations/"+id, "", token).Code)
	}
}

func TestOrganizationsAcceptanceOwnerInsertRollsBack(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	token := registerTokens(t, h, m, "org_accept_rollback", 1)["access_token"]
	_, err := pool.Exec(context.Background(), `CREATE FUNCTION qa_reject_org_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA simulated membership failure'; END $$; CREATE TRIGGER qa_reject_org_member BEFORE INSERT ON organization_members FOR EACH ROW EXECUTE FUNCTION qa_reject_org_member()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS qa_reject_org_member ON organization_members; DROP FUNCTION IF EXISTS qa_reject_org_member()`)
		require.NoError(t, err)
	})
	var before, after int
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT count(*) FROM organizations`).Scan(&before))
	w := testutil.Request(t, h, "POST", "/api/v1/organizations", `{"name":"Must roll back"}`, token)
	require.Equal(t, 500, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "QA simulated")
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT count(*) FROM organizations`).Scan(&after))
	require.Equal(t, before, after, "failed owner membership must not leave an organization")
}

func TestOrganizationsAcceptanceConcurrentPartialPatches(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	m := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, m)
	token := registerTokens(t, h, m, "org_accept_concurrent", 1)["access_token"]
	org := createAcceptanceOrg(t, h, token, `{"name":"Original","locale":"ru"}`)
	path := fmt.Sprintf("/api/v1/organizations/%d", org.ID)
	// Make both requests overlap at the write boundary. The second writer must
	// preserve the first writer's independently changed field after waiting.
	_, err := pool.Exec(context.Background(), `CREATE FUNCTION qa_slow_org_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$; CREATE TRIGGER qa_slow_org_update BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION qa_slow_org_update()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS qa_slow_org_update ON organizations; DROP FUNCTION IF EXISTS qa_slow_org_update()`)
		require.NoError(t, err)
	})
	start := make(chan struct{})
	responses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, body := range []string{`{"name":"Concurrent name"}`, `{"locale":"kk"}`} {
		wg.Add(1)
		go func(body string) {
			defer wg.Done()
			<-start
			responses <- testutil.Request(t, h, "PATCH", path, body, token).Code
		}(body)
	}
	close(start)
	wg.Wait()
	close(responses)
	for code := range responses {
		require.Equal(t, 200, code)
	}
	w := testutil.Request(t, h, "GET", path, "", token)
	require.Equal(t, 200, w.Code, w.Body.String())
	var final orgAcceptanceSummary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &final))
	require.Equal(t, "Concurrent name", final.Name)
	require.Equal(t, "kk", final.Locale)
}

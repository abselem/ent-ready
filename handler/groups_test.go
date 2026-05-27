package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"testing-app/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGroups_Create_OK(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)

	w := testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	require.Equal(t, http.StatusCreated, w.Code)

	var g map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&g))
	assert.Equal(t, "10A", g["name"])
}

func TestGroups_Create_ForbiddenForStudent(t *testing.T) {
	h, mock := newRouter(t)
	student := registerTokens(t, h, mock, "+79992000002", 2) // role_id=2 → student

	w := testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, student["access_token"])
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestGroups_Create_Duplicate(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)

	testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	w := testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestGroups_ListMine(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)

	testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10B","city":"Moscow","school":"School 1"}`, teacher["access_token"])

	w := testutil.Request(t, h, "GET", "/api/v1/groups", "", teacher["access_token"])
	require.Equal(t, http.StatusOK, w.Code)

	var groups []map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&groups))
	assert.Len(t, groups, 2)
}

func TestGroups_Get(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)

	w := testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	var g map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&g))

	id := int(g["id"].(float64))
	w = testutil.Request(t, h, "GET", fmt.Sprintf("/api/v1/groups/%d", id), "", teacher["access_token"])
	require.Equal(t, http.StatusOK, w.Code)

	var g2 map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&g2))
	assert.Equal(t, "10A", g2["name"])
}

func TestGroups_Get_NotFound(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)

	w := testutil.Request(t, h, "GET", "/api/v1/groups/9999", "", teacher["access_token"])
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGroups_AddRemoveStudent(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)
	student := registerTokens(t, h, mock, "+79992000002", 2)

	// Получить student ID
	w := testutil.Request(t, h, "GET", "/api/v1/users/me", "", student["access_token"])
	var me map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&me))
	studentID := int(me["id"].(float64))

	// Создать группу
	w = testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	var g map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&g))
	groupID := int(g["id"].(float64))

	// Добавить студента
	w = testutil.Request(t, h, "POST",
		fmt.Sprintf("/api/v1/groups/%d/students", groupID),
		fmt.Sprintf(`{"user_id":%d}`, studentID),
		teacher["access_token"])
	require.Equal(t, http.StatusCreated, w.Code)

	// Список студентов
	w = testutil.Request(t, h, "GET",
		fmt.Sprintf("/api/v1/groups/%d/students", groupID), "", teacher["access_token"])
	require.Equal(t, http.StatusOK, w.Code)
	var students []map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&students))
	assert.Len(t, students, 1)

	// Удалить студента
	w = testutil.Request(t, h, "DELETE",
		fmt.Sprintf("/api/v1/groups/%d/students/%d", groupID, studentID), "", teacher["access_token"])
	assert.Equal(t, http.StatusNoContent, w.Code)

	// Список должен стать пустым
	w = testutil.Request(t, h, "GET",
		fmt.Sprintf("/api/v1/groups/%d/students", groupID), "", teacher["access_token"])
	var students2 []map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&students2))
	assert.Len(t, students2, 0)
}

func TestGroups_AddStudent_Duplicate(t *testing.T) {
	h, mock := newRouter(t)
	teacher := registerTokens(t, h, mock, "+79992000001", 1)
	student := registerTokens(t, h, mock, "+79992000002", 2)

	w := testutil.Request(t, h, "GET", "/api/v1/users/me", "", student["access_token"])
	var me map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&me))
	studentID := int(me["id"].(float64))

	w = testutil.Request(t, h, "POST", "/api/v1/groups",
		`{"name":"10A","city":"Moscow","school":"School 1"}`, teacher["access_token"])
	var g map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&g))
	groupID := int(g["id"].(float64))

	body := fmt.Sprintf(`{"user_id":%d}`, studentID)
	testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/groups/%d/students", groupID),
		body, teacher["access_token"])
	w = testutil.Request(t, h, "POST", fmt.Sprintf("/api/v1/groups/%d/students", groupID),
		body, teacher["access_token"])
	assert.Equal(t, http.StatusConflict, w.Code)
}

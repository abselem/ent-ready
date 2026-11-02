package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type transferCandidate struct {
	ID    int32  `json:"id"`
	Title string `json:"title"`
}

// Both endpoints are advisory reads. No ownership, visibility, membership or
// historical result is changed; an empty blocker list is not permission to move.
func (h *OrganizationHandler) transferSnapshot(c *gin.Context) (pgx.Tx, int32, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 32)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization id"})
		return nil, 0, false
	}
	tx, err := h.pool.BeginTx(c.Request.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return nil, 0, false
	}
	var role string
	err = tx.QueryRow(c.Request.Context(), `SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active'`, int32(id), c.GetInt32("user_id")).Scan(&role)
	if err != nil {
		_ = tx.Rollback(c.Request.Context())
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(404, gin.H{"error": "organization not found"})
		} else {
			c.JSON(500, gin.H{"error": "internal error"})
		}
		return nil, 0, false
	}
	if role != "owner" && role != "admin" {
		_ = tx.Rollback(c.Request.Context())
		c.JSON(403, gin.H{"error": "insufficient permissions"})
		return nil, 0, false
	}
	return tx, int32(id), true
}

func readTransferCandidates(ctx context.Context, tx pgx.Tx, query string, uid int32) ([]transferCandidate, bool, error) {
	rows, err := tx.Query(ctx, query, uid)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]transferCandidate, 0)
	for rows.Next() {
		var item transferCandidate
		if err := rows.Scan(&item.ID, &item.Title); err != nil {
			return nil, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(items) > 100
	if more {
		items = items[:100]
	}
	return items, more, nil
}

func (h *OrganizationHandler) TransferCandidates(c *gin.Context) {
	tx, _, ok := h.transferSnapshot(c)
	if !ok {
		return
	}
	defer tx.Rollback(c.Request.Context())
	uid := c.GetInt32("user_id")
	ctx := c.Request.Context()
	groups, gm, err := readTransferCandidates(ctx, tx, `SELECT id,name FROM groups WHERE teacher_id=$1 ORDER BY id DESC LIMIT 101`, uid)
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	lessons, lm, err := readTransferCandidates(ctx, tx, `SELECT id,title FROM lessons WHERE created_by=$1 ORDER BY id DESC LIMIT 101`, uid)
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	tests, tm, err := readTransferCandidates(ctx, tx, `SELECT id,title FROM tests WHERE created_by=$1 ORDER BY id DESC LIMIT 101`, uid)
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	c.JSON(200, gin.H{"groups": groups, "lessons": lessons, "tests": tests, "has_more": gin.H{"groups": gm, "lessons": lm, "tests": tm}})
}

const transferClosure = `WITH selected_groups AS (
 SELECT id FROM groups WHERE $1::text='group' AND id=$2 AND teacher_id=$3
), selected_lessons AS (
 SELECT id FROM lessons WHERE created_by=$3 AND (($1::text='lesson' AND id=$2) OR group_id IN (SELECT id FROM selected_groups))
), selected_tests AS (
 SELECT id FROM tests WHERE created_by=$3 AND (($1::text='test' AND id=$2) OR group_id IN (SELECT id FROM selected_groups))
), linked_questions AS (
 SELECT question_id AS id FROM test_questions WHERE test_id IN (SELECT id FROM selected_tests)
 UNION SELECT id FROM questions WHERE test_id IN (SELECT id FROM selected_tests)
), selected_questions AS (
 SELECT q.id,q.context_id FROM questions q JOIN linked_questions l ON l.id=q.id WHERE q.owner_id=$3
), linked_contexts AS (
 SELECT DISTINCT context_id AS id FROM selected_questions WHERE context_id IS NOT NULL
), selected_contexts AS (
 SELECT q.id FROM question_contexts q JOIN linked_contexts l ON l.id=q.id WHERE q.created_by=$3
)
`

type transferBlocker struct {
	Code    string `json:"code"`
	Count   int64  `json:"count"`
	Message string `json:"message"`
}

// Each aggregate is independent: views/access/attempts must not multiply counts.
const transferBlockerQuery = transferClosure + `SELECT code, n FROM (
 SELECT 'requires_group_bundle' AS code, ((SELECT count(*) FROM lessons WHERE $1::text='lesson' AND id=$2 AND group_id IS NOT NULL)+(SELECT count(*) FROM tests WHERE $1::text='test' AND id=$2 AND group_id IS NOT NULL)) AS n
 UNION ALL SELECT 'foreign_owned_content',
 (SELECT count(*) FROM lessons WHERE group_id IN (SELECT id FROM selected_groups) AND created_by IS DISTINCT FROM $3) +
 (SELECT count(*) FROM tests WHERE group_id IN (SELECT id FROM selected_groups) AND created_by IS DISTINCT FROM $3) +
 (SELECT count(*) FROM questions WHERE id IN (SELECT id FROM linked_questions) AND owner_id IS DISTINCT FROM $3) +
 (SELECT count(*) FROM question_contexts WHERE id IN (SELECT id FROM linked_contexts) AND created_by IS DISTINCT FROM $3)
 UNION ALL SELECT 'public_catalogue',
 (SELECT count(*) FROM lessons WHERE id IN (SELECT id FROM selected_lessons) AND is_published AND visibility='all') +
 (SELECT count(*) FROM tests WHERE id IN (SELECT id FROM selected_tests) AND is_published AND is_public)
 UNION ALL SELECT 'test_attempts', (SELECT count(*) FROM test_attempts WHERE test_id IN (SELECT id FROM selected_tests))
 UNION ALL SELECT 'lesson_views', (SELECT count(*) FROM lesson_views WHERE lesson_id IN (SELECT id FROM selected_lessons))
 UNION ALL SELECT 'ent_history', (SELECT count(*) FROM ent_attempt_questions WHERE question_id IN (SELECT id FROM linked_questions))
 UNION ALL SELECT 'shared_questions', (SELECT count(*) FROM questions q WHERE q.id IN (SELECT id FROM selected_questions) AND (
 (q.test_id IS NOT NULL AND q.test_id NOT IN (SELECT id FROM selected_tests)) OR
 EXISTS(SELECT 1 FROM test_questions tq WHERE tq.question_id=q.id AND tq.test_id NOT IN (SELECT id FROM selected_tests))))
 UNION ALL SELECT 'generation_enabled', (SELECT count(*) FROM questions WHERE id IN (SELECT id FROM selected_questions) AND generation_allowed)
 UNION ALL SELECT 'shared_contexts', (SELECT count(*) FROM selected_contexts sc WHERE EXISTS(SELECT 1 FROM questions q WHERE q.context_id=sc.id AND q.id NOT IN (SELECT id FROM selected_questions)))
 UNION ALL SELECT 'missing_memberships', (SELECT count(DISTINCT ug.user_id) FROM user_groups ug WHERE ug.group_id IN (SELECT id FROM selected_groups) AND NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=$4 AND m.user_id=ug.user_id AND m.status='active'))
 UNION ALL SELECT 'external_access', (SELECT count(*) FROM lesson_access a WHERE a.lesson_id IN (SELECT id FROM selected_lessons) AND (
 (a.type='group' AND a.ref_id NOT IN (SELECT id FROM selected_groups)) OR
 (a.type='student' AND NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=$4 AND m.user_id=a.ref_id AND m.status='active'))))
 UNION ALL SELECT 'media_storage',
 (SELECT count(*) FROM lesson_blocks WHERE lesson_id IN (SELECT id FROM selected_lessons) AND type='image' AND btrim(content)<>'') +
 (SELECT count(*) FROM questions WHERE id IN (SELECT id FROM selected_questions) AND (NULLIF(btrim(image_url),'') IS NOT NULL OR NULLIF(btrim(explanation_image_url),'') IS NOT NULL)) +
 (SELECT count(*) FROM question_contexts WHERE id IN (SELECT id FROM selected_contexts) AND NULLIF(btrim(image_url),'') IS NOT NULL)
) checks WHERE n>0 ORDER BY code`

var transferBlockerMessages = map[string]string{
	"requires_group_bundle": "Материал связан с группой. Проверьте перенос всей группы.",
	"foreign_owned_content": "Есть зависимые материалы другого владельца или без подтверждённого владельца.",
	"public_catalogue":      "Опубликованные материалы общего каталога должны оставаться в отдельном каталоге.",
	"test_attempts":         "Есть история прохождения тестов. Для неё требуется отдельная политика переноса.",
	"lesson_views":          "Есть история просмотров уроков. Для неё требуется отдельная политика переноса.",
	"ent_history":           "Вопросы использовались в ЕНТ. История должна сохранять исходные связи.",
	"shared_questions":      "Вопросы связаны с тестами вне выбранного набора.",
	"generation_enabled":    "Есть вопросы, разрешённые для общей генерации тестов.",
	"shared_contexts":       "Контексты используются вопросами вне выбранного набора.",
	"missing_memberships":   "Не все ученики группы имеют активное членство в выбранной организации.",
	"external_access":       "Есть предоставленный доступ за пределами выбранного набора или состава организации.",
	"media_storage":         "Изображения требуют отдельного переноса хранения и прав доступа.",
}

func (h *OrganizationHandler) TransferPreflight(c *gin.Context) {
	tx, orgID, ok := h.transferSnapshot(c)
	if !ok {
		return
	}
	defer tx.Rollback(c.Request.Context())
	var req struct {
		Type *string `json:"resource_type"`
		ID   *int32  `json:"resource_id"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	dec.DisallowUnknownFields()
	err := dec.Decode(&req)
	var trailing any
	if err != nil || req.Type == nil || req.ID == nil || *req.ID <= 0 || (*req.Type != "group" && *req.Type != "lesson" && *req.Type != "test") {
		c.JSON(400, gin.H{"error": "invalid transfer selection"})
		return
	}
	if dec.Decode(&trailing) != io.EOF {
		c.JSON(400, gin.H{"error": "invalid transfer selection"})
		return
	}
	rootQueries := map[string]string{"group": `SELECT name FROM groups WHERE id=$1 AND teacher_id=$2`, "lesson": `SELECT title FROM lessons WHERE id=$1 AND created_by=$2`, "test": `SELECT title FROM tests WHERE id=$1 AND created_by=$2`}
	ctx := c.Request.Context()
	uid := c.GetInt32("user_id")
	var title string
	err = tx.QueryRow(ctx, rootQueries[*req.Type], *req.ID, uid).Scan(&title)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(404, gin.H{"error": "resource not found"})
		} else {
			c.JSON(500, gin.H{"error": "internal error"})
		}
		return
	}
	var asOf time.Time
	if err = tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&asOf); err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	var counts struct {
		Groups    int64 `json:"groups"`
		Lessons   int64 `json:"lessons"`
		Tests     int64 `json:"tests"`
		Questions int64 `json:"questions"`
		Contexts  int64 `json:"contexts"`
	}
	err = tx.QueryRow(ctx, transferClosure+`SELECT (SELECT count(*) FROM selected_groups),(SELECT count(*) FROM selected_lessons),(SELECT count(*) FROM selected_tests),(SELECT count(*) FROM selected_questions),(SELECT count(*) FROM selected_contexts)`, *req.Type, *req.ID, uid).Scan(&counts.Groups, &counts.Lessons, &counts.Tests, &counts.Questions, &counts.Contexts)
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	rows, err := tx.Query(ctx, transferBlockerQuery, *req.Type, *req.ID, uid, orgID)
	if err != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()
	blockers := make([]transferBlocker, 0)
	for rows.Next() {
		var b transferBlocker
		if err = rows.Scan(&b.Code, &b.Count); err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		b.Message = transferBlockerMessages[b.Code]
		blockers = append(blockers, b)
	}
	if rows.Err() != nil {
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}
	c.JSON(200, gin.H{"resource": gin.H{"type": *req.Type, "id": *req.ID, "title": title}, "target_organization_id": orgID, "as_of": asOf, "execution_allowed": false, "tenant_enforcement_ready": false, "counts": counts, "blockers": blockers, "notice": "Проверка не переносит данные. Отсутствие замечаний не означает готовность к переносу; полная изоляция и операция переноса ещё не реализованы."})
}

package handler

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed qa_assets/*.png
var qaImages embed.FS

type qaWorkspace struct {
	OrganizationID   int32  `json:"organization_id"`
	OrganizationName string `json:"organization_name"`
	GroupID          int32  `json:"group_id"`
	GroupName        string `json:"group_name"`
	Role             string `json:"role"`
	Active           bool   `json:"active"`
	IsQA             bool   `json:"is_qa"`
}

func qaWorkspaceFor(c *gin.Context) (qaWorkspace, bool) {
	v, ok := c.Get("qa_workspace")
	if !ok {
		return qaWorkspace{}, false
	}
	q, ok := v.(qaWorkspace)
	return q, ok
}

func qaAccess(c *gin.Context, pool *pgxpool.Pool, author, group any) bool {
	var allowed bool
	err := pool.QueryRow(c.Request.Context(), `SELECT qa_resource_access($1,$2,$3)`, c.GetInt32("user_id"), author, group).Scan(&allowed)
	return err == nil && allowed
}

// QA is a deliberately restricted testing account mode. Normal accounts keep
// their existing scopes; the original resource ownership checks still apply.
func qaBoundary(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetInt32("user_id")
		var q qaWorkspace
		err := pool.QueryRow(c.Request.Context(), `SELECT a.organization_id,o.name,a.default_group_id,g.name,COALESCE(m.role,''),
 COALESCE(m.status='active' AND ((r.teacher_user_id=$1 AND m.role IN('owner','admin','teacher')) OR (r.student_user_id=$1 AND m.role='student')),FALSE)
 FROM qa_workspace_accounts a JOIN organizations o ON o.id=a.organization_id JOIN groups g ON g.id=a.default_group_id
 JOIN qa_workspace_registry r ON r.organization_id=a.organization_id
 LEFT JOIN organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id WHERE a.user_id=$1`, uid).Scan(&q.OrganizationID, &q.OrganizationName, &q.GroupID, &q.GroupName, &q.Role, &q.Active)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			c.AbortWithStatusJSON(500, gin.H{"error": "internal error"})
			return
		}
		bound := err == nil
		path := strings.TrimPrefix(c.FullPath(), "/api/v1/")
		if bound {
			q.IsQA = true
			c.Set("qa_workspace", q)
			profile := path == "qa/context" || path == "auth/logout" || path == "users/me" || path == "users/me/password" || path == "users/me/phone" || path == "users/me/avatar"
			if !q.Active && !profile {
				c.AbortWithStatusJSON(403, gin.H{"error": "QA school access inactive"})
				return
			}
			if !profile {
				if strings.HasPrefix(path, "ent/") || strings.HasSuffix(path, "/random-test") || (c.Request.Method == "POST" && (path == "groups" || path == "topics" || strings.HasSuffix(path, "/subtopics") || path == "organizations")) {
					c.AbortWithStatusJSON(403, gin.H{"error": "operation is outside QA school"})
					return
				}
				if strings.HasPrefix(path, "organizations/:id") && c.Param("id") != strconv.Itoa(int(q.OrganizationID)) {
					c.AbortWithStatusJSON(404, gin.H{"error": "organization not found"})
					return
				}
			}
		}
		// Resolve direct child IDs to their parent scope before invoking old handlers.
		var query string
		var idText string
		parts := strings.Split(path, "/")
		if len(parts) > 1 {
			idText = c.Param("id")
			switch parts[0] {
			case "groups":
				if idText != "" {
					query = `SELECT teacher_id,id FROM groups WHERE id=$1`
				}
			case "lessons":
				if idText != "" {
					query = `SELECT created_by,group_id FROM lessons WHERE id=$1`
				}
			case "tests":
				if idText != "" {
					query = `SELECT created_by,group_id FROM tests WHERE id=$1`
				}
			case "questions":
				if idText != "" {
					query = `SELECT owner_id,NULL::int FROM questions WHERE id=$1`
				}
			case "question-contexts":
				if idText != "" {
					query = `SELECT created_by,NULL::int FROM question_contexts WHERE id=$1`
				}
			case "options":
				if idText != "" {
					query = `SELECT q.owner_id,NULL::int FROM answer_options a JOIN questions q ON q.id=a.question_id WHERE a.id=$1`
				}
			case "lesson-blocks":
				idText = c.Param("blockId")
				query = `SELECT l.created_by,l.group_id FROM lesson_blocks b JOIN lessons l ON l.id=b.lesson_id WHERE b.id=$1`
			case "attempts":
				if idText != "" {
					query = `SELECT t.created_by,t.group_id FROM test_attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=$1`
				}
			}
		}
		if query != "" {
			id, parseErr := strconv.ParseInt(idText, 10, 32)
			if parseErr != nil || id <= 0 {
				c.AbortWithStatusJSON(400, gin.H{"error": "invalid id"})
				return
			}
			var author, group *int32
			err = pool.QueryRow(c.Request.Context(), query, int32(id)).Scan(&author, &group)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					c.AbortWithStatusJSON(404, gin.H{"error": "resource not found"})
				} else {
					c.AbortWithStatusJSON(500, gin.H{"error": "internal error"})
				}
				return
			}
			if !qaAccess(c, pool, author, group) {
				c.AbortWithStatusJSON(404, gin.H{"error": "resource not found"})
				return
			}
		}
		if bound && q.Active && c.Request.Method != "GET" && strings.Contains(c.GetHeader("Content-Type"), "application/json") {
			raw, readErr := io.ReadAll(io.LimitReader(c.Request.Body, 2*1024*1024+1))
			if readErr != nil || len(raw) > 2*1024*1024 {
				c.AbortWithStatusJSON(400, gin.H{"error": "invalid body"})
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(raw))
			var body map[string]json.RawMessage
			if json.Unmarshal(raw, &body) == nil && body != nil {
				var vis string
				_ = json.Unmarshal(body["visibility"], &vis)
				var public, generation, allowGeneration bool
				_ = json.Unmarshal(body["is_public"], &public)
				_ = json.Unmarshal(body["generation_allowed"], &generation)
				_ = json.Unmarshal(body["allow_generation"], &allowGeneration)
				if (vis != "" && vis != "private") || public || generation || allowGeneration {
					c.AbortWithStatusJSON(403, gin.H{"error": "QA materials must remain private"})
					return
				}
				if path == "lessons/:id/access" && c.Request.Method == "POST" {
					var kind string
					var ref int32
					_ = json.Unmarshal(body["type"], &kind)
					_ = json.Unmarshal(body["ref_id"], &ref)
					permitted := kind == "group" && ref == q.GroupID
					if kind == "student" {
						if err := pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active' AND role IN('owner','admin','teacher','student'))`, q.OrganizationID, ref).Scan(&permitted); err != nil {
							c.AbortWithStatusJSON(500, gin.H{"error": "internal error"})
							return
						}
					}
					if !permitted {
						c.AbortWithStatusJSON(403, gin.H{"error": "QA school access required"})
						return
					}
				}
				if value, exists := body["group_id"]; exists && string(value) != "null" {
					var group int32
					if json.Unmarshal(value, &group) != nil || group != q.GroupID {
						c.AbortWithStatusJSON(403, gin.H{"error": "QA group required"})
						return
					}
				}
				if c.Request.Method == "POST" && (path == "lessons" || path == "tests") {
					body["group_id"], _ = json.Marshal(q.GroupID)
					raw, _ = json.Marshal(body)
					c.Request.Body = io.NopCloser(bytes.NewReader(raw))
				}
			}
		}
		c.Next()
	}
}

func qaContext(c *gin.Context) {
	if q, ok := qaWorkspaceFor(c); ok {
		c.JSON(200, q)
		return
	}
	c.JSON(200, gin.H{"is_qa": false})
}

func qaAsset(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("topicId"))
		if err != nil || id < 1 || id > 14 {
			c.AbortWithStatus(404)
			return
		}
		var allowed bool
		err = pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM qa_workspace_registry r JOIN organization_members m ON m.organization_id=r.organization_id WHERE m.user_id=$1 AND m.status='active' AND m.role IN('owner','admin','teacher','student'))`, c.GetInt32("user_id")).Scan(&allowed)
		if err != nil {
			c.AbortWithStatus(500)
			return
		}
		if !allowed {
			c.AbortWithStatus(404)
			return
		}
		data, err := qaImages.ReadFile("qa_assets/subject-" + strconv.Itoa(id) + ".png")
		if err != nil {
			c.AbortWithStatus(404)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, "image/png", data)
	}
}

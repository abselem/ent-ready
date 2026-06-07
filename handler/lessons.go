package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"testing-app/config"
	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type LessonHandler struct {
	q    db.Querier
	pool *pgxpool.Pool
}

func NewLessonHandler(pool *pgxpool.Pool, _ *config.Config) *LessonHandler {
	return &LessonHandler{q: db.New(pool), pool: pool}
}

// ─── Create ───────────────────────────────────────────────────────────────────

type createLessonReq struct {
	Title       string  `json:"title" binding:"required"`
	Description string  `json:"description"`
	ScheduledAt *string `json:"scheduled_at"` // optional RFC3339
	DurationMin int16   `json:"duration_min"`
	GroupID     *int32  `json:"group_id"`    // optional
	Visibility  string  `json:"visibility"`  // all | school | course | private
	TopicID     *int32  `json:"topic_id"`    // optional subject
	SubtopicID  *int32  `json:"subtopic_id"`  // optional sub-subject
}

// POST /api/v1/groups/:id/lessons  OR  POST /api/v1/lessons
func (h *LessonHandler) Create(c *gin.Context) {
	var req createLessonReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID, _ := c.Get("user_id")

	var groupID pgtype.Int4
	if idStr := c.Param("id"); idStr != "" {
		gid, err := parseID(c, "id")
		if err != nil {
			return
		}
		groupID = pgtype.Int4{Int32: gid, Valid: true}
	} else if req.GroupID != nil {
		groupID = pgtype.Int4{Int32: *req.GroupID, Valid: true}
	}

	var scheduledAt pgtype.Timestamptz
	if req.ScheduledAt != nil && *req.ScheduledAt != "" {
		if t, err := time.Parse(time.RFC3339, *req.ScheduledAt); err == nil {
			scheduledAt = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}

	dur := req.DurationMin
	if dur == 0 {
		dur = 45
	}
	vis := req.Visibility
	if vis == "" {
		vis = "private"
	}

	var topicID pgtype.Int4
	if req.TopicID != nil {
		topicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}
	var subtopicID pgtype.Int4
	if req.SubtopicID != nil {
		subtopicID = pgtype.Int4{Int32: *req.SubtopicID, Valid: true}
	}

	// Insert with topic_id and subtopic_id using raw query
	ctx := context.Background()
	var lesson db.Lesson
	var retTopicID pgtype.Int4
	var retSubtopicID pgtype.Int4
	scanErr := h.pool.QueryRow(ctx, `
		INSERT INTO lessons (group_id, title, description, scheduled_at, duration_min, visibility, created_by, topic_id, subtopic_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+db.AllLessonCols+`, topic_id, subtopic_id
	`, groupID, req.Title,
		pgtype.Text{String: req.Description, Valid: req.Description != ""},
		scheduledAt, dur, vis,
		pgtype.Int4{Int32: userID.(int32), Valid: true},
		topicID, subtopicID,
	).Scan(
		&lesson.ID, &lesson.GroupID, &lesson.Title, &lesson.Description,
		&lesson.ScheduledAt, &lesson.DurationMin, &lesson.CreatedAt, &lesson.UpdatedAt,
		&lesson.SectionTitle, &lesson.SectionNum, &lesson.OrderNum,
		&lesson.IsPublished, &lesson.Visibility, &lesson.ViewCount, &lesson.CreatedBy,
		&retTopicID, &retSubtopicID,
	)
	if scanErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, lesson)
}

// ─── List (GET /groups/:id/lessons) ─────────────────────────────────────────

func (h *LessonHandler) List(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	limit := int32(100)
	offset := int32(0)
	if l, err2 := strconv.Atoi(c.DefaultQuery("limit", "100")); err2 == nil && l > 0 {
		limit = int32(l)
	}
	lessons, err := h.q.GetLessonsByGroup(context.Background(), db.GetLessonsByGroupParams{
		GroupID: pgtype.Int4{Int32: groupID, Valid: true},
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if lessons == nil {
		lessons = []db.Lesson{}
	}
	c.JSON(http.StatusOK, lessons)
}

// ─── List teacher's own lessons ───────────────────────────────────────────────

// GET /api/v1/lessons/mine
func (h *LessonHandler) ListMine(c *gin.Context) {
	userID, _ := c.Get("user_id")
	ctx := context.Background()

	rows, err := h.pool.Query(ctx, `
		SELECT l.id, l.group_id, l.title, l.description, l.scheduled_at,
		       l.duration_min, l.created_at, l.updated_at,
		       l.section_title, l.section_num, l.order_num,
		       l.is_published, l.visibility, l.view_count, l.created_by,
		       COALESCE(g.name, '') AS group_name,
		       l.topic_id,
		       COALESCE(t.name, '') AS topic_name,
		       l.subtopic_id,
		       COALESCE(st.name, '') AS subtopic_name
		FROM lessons l
		LEFT JOIN groups g ON g.id = l.group_id
		LEFT JOIN topics t ON t.id = l.topic_id
		LEFT JOIN subtopics st ON st.id = l.subtopic_id
		WHERE l.created_by = $1
		ORDER BY l.created_at DESC
	`, userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	type mineLessonRow struct {
		db.Lesson
		GroupName  string `json:"group_name"`
		TopicID    *int32 `json:"topic_id"`
		TopicName  string `json:"topic_name"`
		SubtopicID *int32 `json:"subtopic_id"`
		SubtopicName string `json:"subtopic_name"`
	}
	result := []mineLessonRow{}
	for rows.Next() {
		var r mineLessonRow
		var gname pgtype.Text
		var tid pgtype.Int4
		var stid pgtype.Int4
		if err := rows.Scan(
			&r.ID, &r.GroupID, &r.Title, &r.Description,
			&r.ScheduledAt, &r.DurationMin, &r.CreatedAt, &r.UpdatedAt,
			&r.SectionTitle, &r.SectionNum, &r.OrderNum,
			&r.IsPublished, &r.Visibility, &r.ViewCount, &r.CreatedBy,
			&gname, &tid, &r.TopicName, &stid, &r.SubtopicName,
		); err != nil {
			continue
		}
		r.GroupName = gname.String
		if tid.Valid {
			v := tid.Int32
			r.TopicID = &v
		}
		if stid.Valid {
			v := stid.Int32
			r.SubtopicID = &v
		}
		result = append(result, r)
	}
	c.JSON(http.StatusOK, result)
}

// ─── Available lessons for current student ────────────────────────────────────

// GET /api/v1/lessons/available
func (h *LessonHandler) ListAvailable(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(int32)
	ctx := context.Background()

	rows, err := h.pool.Query(ctx, `
		SELECT l.id, l.group_id, l.title, l.description, l.scheduled_at,
		       l.duration_min, l.created_at, l.updated_at,
		       l.section_title, l.section_num, l.order_num,
		       l.is_published, l.visibility, l.view_count, l.created_by,
		       COALESCE(g.name, '')     AS group_name,
		       COALESCE(g.category, '') AS group_category,
		       l.topic_id,
		       COALESCE(t.name, '')     AS topic_name,
		       l.subtopic_id,
		       COALESCE(st.name, '')    AS subtopic_name
		FROM lessons l
		LEFT JOIN groups g ON g.id = l.group_id
		LEFT JOIN topics t ON t.id = l.topic_id
		LEFT JOIN subtopics st ON st.id = l.subtopic_id
		WHERE l.is_published = TRUE
		  AND (
		    -- Для всех
		    l.visibility = 'all'

		    -- Привязан к группе — ученик состоит в ней
		    OR (l.group_id IS NOT NULL AND EXISTS (
		      SELECT 1 FROM user_groups ug
		      WHERE ug.user_id = $1 AND ug.group_id = l.group_id
		    ))

		    -- Для школьных групп учителя
		    OR (l.visibility = 'school' AND l.created_by IS NOT NULL AND EXISTS (
		      SELECT 1 FROM user_groups ug
		      JOIN groups sg ON sg.id = ug.group_id
		      WHERE ug.user_id = $1
		        AND sg.category = 'school'
		        AND sg.teacher_id = l.created_by
		    ))

		    -- Для курсовых групп учителя
		    OR (l.visibility = 'course' AND l.created_by IS NOT NULL AND EXISTS (
		      SELECT 1 FROM user_groups ug
		      JOIN groups cg ON cg.id = ug.group_id
		      WHERE ug.user_id = $1
		        AND cg.category = 'course'
		        AND cg.teacher_id = l.created_by
		    ))

		    -- Приватный — явный доступ
		    OR (l.visibility = 'private' AND (
		      EXISTS (
		        SELECT 1 FROM lesson_access la
		        WHERE la.lesson_id = l.id AND la.type = 'student' AND la.ref_id = $1
		      )
		      OR EXISTS (
		        SELECT 1 FROM lesson_access la
		        JOIN user_groups ug ON ug.group_id = la.ref_id
		        WHERE la.lesson_id = l.id AND la.type = 'group' AND ug.user_id = $1
		      )
		    ))
		  )
		ORDER BY l.created_at DESC
	`, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	type lessonRow struct {
		ID            int32   `json:"id"`
		GroupID       *int32  `json:"group_id"`
		Title         string  `json:"title"`
		Description   string  `json:"description"`
		ScheduledAt   *string `json:"scheduled_at"`
		DurationMin   int16   `json:"duration_min"`
		CreatedAt     string  `json:"created_at"`
		SectionTitle  *string `json:"section_title"`
		SectionNum    int16   `json:"section_num"`
		OrderNum      int16   `json:"order_num"`
		Visibility    string  `json:"visibility"`
		ViewCount     int32   `json:"view_count"`
		GroupName     string  `json:"group_name"`
		GroupCategory string  `json:"group_category"`
		TopicID       *int32  `json:"topic_id"`
		TopicName     string  `json:"topic_name"`
		SubtopicID    *int32  `json:"subtopic_id"`
		SubtopicName  string  `json:"subtopic_name"`
	}

	result := []lessonRow{}
	for rows.Next() {
		var r lessonRow
		var (
			groupID       pgtype.Int4
			description   pgtype.Text
			scheduledAt   pgtype.Timestamptz
			createdAt     pgtype.Timestamptz
			updatedAt     pgtype.Timestamptz
			sectionTitle  pgtype.Text
			sectionNum    pgtype.Int2
			orderNum      pgtype.Int2
			isPublished   bool
			viewCount     pgtype.Int4
			createdBy     pgtype.Int4
			topicID       pgtype.Int4
			subtopicID    pgtype.Int4
		)
		if err := rows.Scan(
			&r.ID, &groupID, &r.Title, &description, &scheduledAt,
			&r.DurationMin, &createdAt, &updatedAt,
			&sectionTitle, &sectionNum, &orderNum,
			&isPublished, &r.Visibility, &viewCount, &createdBy,
			&r.GroupName, &r.GroupCategory,
			&topicID, &r.TopicName,
			&subtopicID, &r.SubtopicName,
		); err != nil {
			continue
		}
		if topicID.Valid {
			v := topicID.Int32
			r.TopicID = &v
		}
		if subtopicID.Valid {
			v := subtopicID.Int32
			r.SubtopicID = &v
		}
		if groupID.Valid {
			v := groupID.Int32
			r.GroupID = &v
		}
		if description.Valid {
			r.Description = description.String
		}
		if scheduledAt.Valid {
			s := scheduledAt.Time.Format(time.RFC3339)
			r.ScheduledAt = &s
		}
		if createdAt.Valid {
			r.CreatedAt = createdAt.Time.Format(time.RFC3339)
		}
		if sectionTitle.Valid {
			r.SectionTitle = &sectionTitle.String
		}
		if sectionNum.Valid {
			r.SectionNum = sectionNum.Int16
		}
		if orderNum.Valid {
			r.OrderNum = orderNum.Int16
		}
		if viewCount.Valid {
			r.ViewCount = viewCount.Int32
		}
		result = append(result, r)
	}
	c.JSON(http.StatusOK, result)
}

// ─── Get ──────────────────────────────────────────────────────────────────────

func (h *LessonHandler) Get(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	lesson, err := h.q.GetLessonByID(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "lesson not found"})
		return
	}
	c.JSON(http.StatusOK, lesson)
}

// ─── Update ───────────────────────────────────────────────────────────────────

type updateLessonReq struct {
	Title       string  `json:"title" binding:"required"`
	Description string  `json:"description"`
	ScheduledAt *string `json:"scheduled_at"` // optional
	DurationMin int16   `json:"duration_min"`
}

func (h *LessonHandler) Update(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req updateLessonReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var scheduledAt pgtype.Timestamptz
	if req.ScheduledAt != nil && *req.ScheduledAt != "" {
		if t, err2 := time.Parse(time.RFC3339, *req.ScheduledAt); err2 == nil {
			scheduledAt = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	dur := req.DurationMin
	if dur == 0 {
		dur = 45
	}
	lesson, err := h.q.UpdateLesson(context.Background(), db.UpdateLessonParams{
		ID:          id,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		ScheduledAt: scheduledAt,
		DurationMin: dur,
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "lesson not found"})
		return
	}
	c.JSON(http.StatusOK, lesson)
}

// ─── Update topics (theme/subtheme) ────────────────────────────────────────────

type updateLessonTopicsReq struct {
	TopicID    *int32 `json:"topic_id"`
	SubtopicID *int32 `json:"subtopic_id"`
}

// PUT /api/v1/lessons/:id/topics
func (h *LessonHandler) UpdateTopics(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req updateLessonTopicsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var topicID pgtype.Int4
	if req.TopicID != nil {
		topicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}
	var subtopicID pgtype.Int4
	if req.SubtopicID != nil {
		subtopicID = pgtype.Int4{Int32: *req.SubtopicID, Valid: true}
	}

	ctx := context.Background()
	_, err = h.pool.Exec(ctx, `
		UPDATE lessons SET topic_id=$2, subtopic_id=$3 WHERE id=$1
	`, id, topicID, subtopicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── Delete ───────────────────────────────────────────────────────────────────

func (h *LessonHandler) Delete(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	h.q.DeleteLesson(context.Background(), id)
	c.Status(http.StatusNoContent)
}

// ─── Publish ──────────────────────────────────────────────────────────────────

type publishLessonReq struct {
	Visibility string `json:"visibility"` // all | school | course | private
}

// POST /api/v1/lessons/:id/publish
func (h *LessonHandler) Publish(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req publishLessonReq
	_ = c.ShouldBindJSON(&req)
	if req.Visibility == "" {
		req.Visibility = "all"
	}
	ctx := context.Background()
	var lesson db.Lesson
	err = h.pool.QueryRow(ctx, `
		UPDATE lessons SET is_published=TRUE, visibility=$2 WHERE id=$1
		RETURNING `+db.AllLessonCols, id, req.Visibility).Scan(
		&lesson.ID, &lesson.GroupID, &lesson.Title, &lesson.Description,
		&lesson.ScheduledAt, &lesson.DurationMin, &lesson.CreatedAt, &lesson.UpdatedAt,
		&lesson.SectionTitle, &lesson.SectionNum, &lesson.OrderNum,
		&lesson.IsPublished, &lesson.Visibility, &lesson.ViewCount, &lesson.CreatedBy,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "lesson not found"})
		return
	}
	c.JSON(http.StatusOK, lesson)
}

// POST /api/v1/lessons/:id/unpublish
func (h *LessonHandler) Unpublish(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	h.pool.Exec(context.Background(), `UPDATE lessons SET is_published=FALSE WHERE id=$1`, id)
	c.Status(http.StatusNoContent)
}

// ─── View recording ───────────────────────────────────────────────────────────

// POST /api/v1/lessons/:id/view
func (h *LessonHandler) RecordView(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")
	ctx := context.Background()
	var inserted bool
	h.pool.QueryRow(ctx, `
		INSERT INTO lesson_views (lesson_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
		RETURNING TRUE
	`, id, userID.(int32)).Scan(&inserted)
	if inserted {
		h.pool.Exec(ctx, `UPDATE lessons SET view_count = view_count + 1 WHERE id=$1`, id)
	}
	c.Status(http.StatusNoContent)
}

// ─── Viewers ─────────────────────────────────────────────────────────────────

// GET /api/v1/lessons/:id/viewers?search=
func (h *LessonHandler) ListViewers(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	search := c.Query("search")
	ctx := context.Background()

	type viewerRow struct {
		UserID    int32  `json:"user_id"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Phone     string `json:"phone"`
		ViewedAt  string `json:"viewed_at"`
	}
	rows, err := h.pool.Query(ctx, `
		SELECT u.id, u.first_name, u.last_name, u.phone,
		       to_char(lv.viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS viewed_at
		FROM lesson_views lv
		JOIN users u ON u.id = lv.user_id
		WHERE lv.lesson_id = $1
		  AND ($2 = '' OR lower(u.first_name || ' ' || u.last_name) LIKE lower('%' || $2 || '%'))
		ORDER BY lv.viewed_at DESC
	`, id, search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	result := []viewerRow{}
	for rows.Next() {
		var r viewerRow
		if rows.Scan(&r.UserID, &r.FirstName, &r.LastName, &r.Phone, &r.ViewedAt) == nil {
			result = append(result, r)
		}
	}
	c.JSON(http.StatusOK, result)
}

// ─── Access management (private visibility) ───────────────────────────────────

type grantAccessReq struct {
	Type  string `json:"type" binding:"required"` // group | student
	RefID int32  `json:"ref_id" binding:"required"`
}

// POST /api/v1/lessons/:id/access
func (h *LessonHandler) GrantAccess(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req grantAccessReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.pool.Exec(context.Background(), `
		INSERT INTO lesson_access (lesson_id, type, ref_id)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, id, req.Type, req.RefID)
	c.Status(http.StatusNoContent)
}

// DELETE /api/v1/lessons/:id/access/:type/:refId
func (h *LessonHandler) RevokeAccess(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	atype := c.Param("type")
	refID, err := parseID(c, "refId")
	if err != nil {
		return
	}
	h.pool.Exec(context.Background(), `
		DELETE FROM lesson_access WHERE lesson_id=$1 AND type=$2 AND ref_id=$3
	`, id, atype, refID)
	c.Status(http.StatusNoContent)
}

// GET /api/v1/lessons/:id/access
func (h *LessonHandler) ListAccess(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	ctx := context.Background()

	type accessRow struct {
		Type  string `json:"type"`
		RefID int32  `json:"ref_id"`
		Name  string `json:"name"`
	}
	rows, err := h.pool.Query(ctx, `
		SELECT la.type, la.ref_id,
		       CASE la.type
		         WHEN 'group'   THEN g.name
		         WHEN 'student' THEN u.first_name || ' ' || u.last_name
		       END AS name
		FROM lesson_access la
		LEFT JOIN groups g ON g.id = la.ref_id AND la.type = 'group'
		LEFT JOIN users  u ON u.id = la.ref_id AND la.type = 'student'
		WHERE la.lesson_id = $1
		ORDER BY la.type, la.ref_id
	`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	result := []accessRow{}
	for rows.Next() {
		var r accessRow
		var name pgtype.Text
		if rows.Scan(&r.Type, &r.RefID, &name) == nil {
			r.Name = name.String
			result = append(result, r)
		}
	}
	c.JSON(http.StatusOK, result)
}

// ─── Block CRUD ───────────────────────────────────────────────────────────────

type lessonBlock struct {
	ID       int32  `json:"id"`
	LessonID int32  `json:"lesson_id"`
	Type     string `json:"type"`
	Content  string `json:"content"`
	Language string `json:"language"`
	Caption  string `json:"caption"`
	OrderNum int16  `json:"order_num"`
}

func scanBlock(row interface {
	Scan(dest ...any) error
}) (lessonBlock, error) {
	var b lessonBlock
	err := row.Scan(&b.ID, &b.LessonID, &b.Type, &b.Content, &b.Language, &b.Caption, &b.OrderNum)
	return b, err
}

const blockSelect = `
	SELECT id, lesson_id, type, content,
	       COALESCE(language, '') AS language,
	       COALESCE(caption, '')  AS caption,
	       order_num
	FROM lesson_blocks`

func (h *LessonHandler) ListBlocks(c *gin.Context) {
	lessonID, err := parseID(c, "id")
	if err != nil {
		return
	}
	rows, err := h.pool.Query(context.Background(),
		blockSelect+` WHERE lesson_id=$1 ORDER BY order_num, id`, lessonID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()
	blocks := []lessonBlock{}
	for rows.Next() {
		b, err := scanBlock(rows)
		if err == nil {
			blocks = append(blocks, b)
		}
	}
	c.JSON(http.StatusOK, blocks)
}

type createBlockReq struct {
	Type     string `json:"type" binding:"required"`
	Content  string `json:"content"`
	Language string `json:"language"`
	Caption  string `json:"caption"`
}

func (h *LessonHandler) CreateBlock(c *gin.Context) {
	lessonID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req createBlockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := context.Background()
	var maxOrder int16
	h.pool.QueryRow(ctx, `SELECT COALESCE(MAX(order_num), -1) FROM lesson_blocks WHERE lesson_id=$1`, lessonID).Scan(&maxOrder)
	var b lessonBlock
	err = h.pool.QueryRow(ctx, `
		INSERT INTO lesson_blocks (lesson_id, type, content, language, caption, order_num)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, lesson_id, type, content, COALESCE(language,''), COALESCE(caption,''), order_num
	`, lessonID, req.Type, req.Content, strOrNil(req.Language), strOrNil(req.Caption), maxOrder+1).
		Scan(&b.ID, &b.LessonID, &b.Type, &b.Content, &b.Language, &b.Caption, &b.OrderNum)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, b)
}

type updateBlockReq struct {
	Content  string `json:"content"`
	Language string `json:"language"`
	Caption  string `json:"caption"`
}

func (h *LessonHandler) UpdateBlock(c *gin.Context) {
	blockID, err := parseID(c, "blockId")
	if err != nil {
		return
	}
	var req updateBlockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var b lessonBlock
	err = h.pool.QueryRow(context.Background(), `
		UPDATE lesson_blocks SET content=$2, language=$3, caption=$4 WHERE id=$1
		RETURNING id, lesson_id, type, content, COALESCE(language,''), COALESCE(caption,''), order_num
	`, blockID, req.Content, strOrNil(req.Language), strOrNil(req.Caption)).
		Scan(&b.ID, &b.LessonID, &b.Type, &b.Content, &b.Language, &b.Caption, &b.OrderNum)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block not found"})
		return
	}
	c.JSON(http.StatusOK, b)
}

func (h *LessonHandler) DeleteBlock(c *gin.Context) {
	blockID, err := parseID(c, "blockId")
	if err != nil {
		return
	}
	h.pool.Exec(context.Background(), `DELETE FROM lesson_blocks WHERE id=$1`, blockID)
	c.Status(http.StatusNoContent)
}

type reorderBlocksReq struct {
	Order []struct {
		ID       int32 `json:"id"`
		OrderNum int16 `json:"order_num"`
	} `json:"order"`
}

func (h *LessonHandler) ReorderBlocks(c *gin.Context) {
	var req reorderBlocksReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := context.Background()
	for _, item := range req.Order {
		h.pool.Exec(ctx, `UPDATE lesson_blocks SET order_num=$2 WHERE id=$1`, item.ID, item.OrderNum)
	}
	c.Status(http.StatusNoContent)
}

func strOrNil(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

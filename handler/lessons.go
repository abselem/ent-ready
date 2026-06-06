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

// ─── Lesson CRUD ──────────────────────────────────────────────────────────────

// POST /api/v1/groups/:id/lessons
type createLessonReq struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	ScheduledAt string `json:"scheduled_at" binding:"required"` // RFC3339
	DurationMin int16  `json:"duration_min"`
}

func (h *LessonHandler) Create(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req createLessonReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	t, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scheduled_at must be RFC3339"})
		return
	}

	dur := req.DurationMin
	if dur == 0 {
		dur = 45
	}

	lesson, err := h.q.CreateLesson(context.Background(), db.CreateLessonParams{
		GroupID:     groupID,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		ScheduledAt: pgtype.Timestamptz{Time: t, Valid: true},
		DurationMin: dur,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, lesson)
}

// GET /api/v1/groups/:id/lessons?limit=20&offset=0
func (h *LessonHandler) List(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}

	limit := int32(100)
	offset := int32(0)
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "100")); err == nil && l > 0 {
		limit = int32(l)
	}
	if o, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil && o >= 0 {
		offset = int32(o)
	}

	lessons, err := h.q.GetLessonsByGroup(context.Background(), db.GetLessonsByGroupParams{
		GroupID: groupID,
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

// GET /api/v1/lessons/:id
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

// PUT /api/v1/lessons/:id
type updateLessonReq struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	ScheduledAt string `json:"scheduled_at" binding:"required"`
	DurationMin int16  `json:"duration_min"`
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

	t, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scheduled_at must be RFC3339"})
		return
	}

	dur := req.DurationMin
	if dur == 0 {
		dur = 45
	}

	lesson, err := h.q.UpdateLesson(context.Background(), db.UpdateLessonParams{
		ID:          id,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		ScheduledAt: pgtype.Timestamptz{Time: t, Valid: true},
		DurationMin: dur,
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "lesson not found"})
		return
	}
	c.JSON(http.StatusOK, lesson)
}

// DELETE /api/v1/lessons/:id
func (h *LessonHandler) Delete(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	if err := h.q.DeleteLesson(context.Background(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── Lesson Blocks ────────────────────────────────────────────────────────────

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

// GET /api/v1/lessons/:id/blocks
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

// POST /api/v1/lessons/:id/blocks
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
	h.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(order_num), -1) FROM lesson_blocks WHERE lesson_id=$1`, lessonID).Scan(&maxOrder)

	lang := strOrNil(req.Language)
	caption := strOrNil(req.Caption)

	var b lessonBlock
	err = h.pool.QueryRow(ctx, `
		INSERT INTO lesson_blocks (lesson_id, type, content, language, caption, order_num)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, lesson_id, type, content,
		          COALESCE(language,''), COALESCE(caption,''), order_num
	`, lessonID, req.Type, req.Content, lang, caption, maxOrder+1).
		Scan(&b.ID, &b.LessonID, &b.Type, &b.Content, &b.Language, &b.Caption, &b.OrderNum)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, b)
}

// PUT /api/v1/lesson-blocks/:blockId
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
		UPDATE lesson_blocks
		SET content=$2, language=$3, caption=$4
		WHERE id=$1
		RETURNING id, lesson_id, type, content,
		          COALESCE(language,''), COALESCE(caption,''), order_num
	`, blockID, req.Content, strOrNil(req.Language), strOrNil(req.Caption)).
		Scan(&b.ID, &b.LessonID, &b.Type, &b.Content, &b.Language, &b.Caption, &b.OrderNum)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block not found"})
		return
	}
	c.JSON(http.StatusOK, b)
}

// DELETE /api/v1/lesson-blocks/:blockId
func (h *LessonHandler) DeleteBlock(c *gin.Context) {
	blockID, err := parseID(c, "blockId")
	if err != nil {
		return
	}
	h.pool.Exec(context.Background(), `DELETE FROM lesson_blocks WHERE id=$1`, blockID)
	c.Status(http.StatusNoContent)
}

// POST /api/v1/lessons/:id/blocks/reorder
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

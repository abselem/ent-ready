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
	q db.Querier
}

func NewLessonHandler(pool *pgxpool.Pool, _ *config.Config) *LessonHandler {
	return &LessonHandler{q: db.New(pool)}
}

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

	limit := int32(20)
	offset := int32(0)
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil && l > 0 {
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

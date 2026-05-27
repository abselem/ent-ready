package handler

import (
	"context"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"testing-app/config"
	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupHandler struct {
	q db.Querier
}

func NewGroupHandler(pool *pgxpool.Pool, _ *config.Config) *GroupHandler {
	return &GroupHandler{q: db.New(pool)}
}

const inviteCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generateInviteCode() string {
	src := rand.New(rand.NewSource(time.Now().UnixNano()))
	b := make([]byte, 6)
	for i := range b {
		b[i] = inviteCodeChars[src.Intn(len(inviteCodeChars))]
	}
	return string(b)
}

// POST /api/v1/groups
type createGroupReq struct {
	Name   string `json:"name" binding:"required"`
	City   string `json:"city" binding:"required"`
	School string `json:"school" binding:"required"`
}

func (h *GroupHandler) Create(c *gin.Context) {
	var req createGroupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	teacherID, _ := c.Get("user_id")
	code := generateInviteCode()
	group, err := h.q.CreateGroup(context.Background(), db.CreateGroupParams{
		Name:       req.Name,
		City:       req.City,
		School:     req.School,
		TeacherID:  teacherID.(int32),
		InviteCode: code,
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "group already exists"})
		return
	}
	c.JSON(http.StatusCreated, group)
}

// GET /api/v1/groups  (teacher's own groups)
func (h *GroupHandler) ListMine(c *gin.Context) {
	teacherID, _ := c.Get("user_id")
	groups, err := h.q.GetGroupsByTeacher(context.Background(), teacherID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, groups)
}

// GET /api/v1/groups/joined  (student's groups)
func (h *GroupHandler) ListJoined(c *gin.Context) {
	userID, _ := c.Get("user_id")
	groups, err := h.q.GetGroupsByUser(context.Background(), userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, groups)
}

// GET /api/v1/groups/:id
func (h *GroupHandler) Get(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	group, err := h.q.GetGroupByID(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return
	}
	c.JSON(http.StatusOK, group)
}

// GET /api/v1/groups/:id/students
func (h *GroupHandler) ListStudents(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	students, err := h.q.GetStudentsByGroup(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, students)
}

// POST /api/v1/groups/:id/students  (teacher adds student by user_id)
type addStudentReq struct {
	UserID int32 `json:"user_id" binding:"required"`
}

func (h *GroupHandler) AddStudent(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req addStudentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entry, err := h.q.AddStudentToGroup(context.Background(), db.AddStudentToGroupParams{
		UserID:  req.UserID,
		GroupID: groupID,
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "student already in this group"})
		return
	}
	c.JSON(http.StatusCreated, entry)
}

// DELETE /api/v1/groups/:id/students/:user_id  (teacher removes student)
func (h *GroupHandler) RemoveStudent(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, err := parseID(c, "user_id")
	if err != nil {
		return
	}
	if err := h.q.RemoveStudentFromGroup(context.Background(), db.RemoveStudentFromGroupParams{
		UserID:  userID,
		GroupID: groupID,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.Status(http.StatusNoContent)
}

// POST /api/v1/groups/join  (student self-join by invite code)
type joinGroupReq struct {
	InviteCode string `json:"invite_code" binding:"required"`
}

func (h *GroupHandler) JoinGroup(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req joinGroupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group, err := h.q.GetGroupByCode(context.Background(), req.InviteCode)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Группа не найдена. Проверьте код."})
		return
	}

	count, err := h.q.CountUserGroups(context.Background(), userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if count >= 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Можно состоять максимум в 2 группах"})
		return
	}

	entry, err := h.q.AddStudentToGroup(context.Background(), db.AddStudentToGroupParams{
		UserID:  userID.(int32),
		GroupID: group.ID,
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Вы уже состоите в этой группе"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"group": group, "membership": entry})
}

// DELETE /api/v1/groups/:id/leave  (student leaves a group)
func (h *GroupHandler) LeaveGroup(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")
	if err := h.q.RemoveStudentFromGroup(context.Background(), db.RemoveStudentFromGroupParams{
		UserID:  userID.(int32),
		GroupID: groupID,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.Status(http.StatusNoContent)
}

func parseID(c *gin.Context, param string) (int32, error) {
	n, err := strconv.Atoi(c.Param(param))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid " + param})
		return 0, err
	}
	return int32(n), nil
}

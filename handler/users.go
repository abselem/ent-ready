package handler

import (
	"context"
	"net/http"

	"testing-app/config"
	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct {
	q db.Querier
}

func NewUserHandler(pool *pgxpool.Pool, _ *config.Config) *UserHandler {
	return &UserHandler{q: db.New(pool)}
}

// GET /api/v1/users/me
func (h *UserHandler) GetMe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	user, err := h.q.GetUserByID(context.Background(), userID.(int32))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// PUT /api/v1/users/me
type updateMeReq struct {
	FirstName       string `json:"first_name" binding:"required"`
	LastName        string `json:"last_name" binding:"required"`
	MiddleName      string `json:"middle_name"`
	City            string `json:"city"`
	ProfileSubject1 *int32 `json:"profile_subject1"`
	ProfileSubject2 *int32 `json:"profile_subject2"`
}

func (h *UserHandler) UpdateMe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req updateMeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sub1 := pgtype.Int4{}
	if req.ProfileSubject1 != nil {
		sub1 = pgtype.Int4{Int32: *req.ProfileSubject1, Valid: true}
	}
	sub2 := pgtype.Int4{}
	if req.ProfileSubject2 != nil {
		sub2 = pgtype.Int4{Int32: *req.ProfileSubject2, Valid: true}
	}

	user, err := h.q.UpdateUserProfile(context.Background(), db.UpdateUserProfileParams{
		ID:              userID.(int32),
		FirstName:       req.FirstName,
		LastName:        req.LastName,
		MiddleName:      pgtype.Text{String: req.MiddleName, Valid: req.MiddleName != ""},
		City:            pgtype.Text{String: req.City, Valid: req.City != ""},
		ProfileSubject1: sub1,
		ProfileSubject2: sub2,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// PUT /api/v1/users/me/password
type setPasswordReq struct {
	Password string `json:"password" binding:"required,min=8"`
}

func (h *UserHandler) SetPassword(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req setPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if err := h.q.UpdatePassword(context.Background(), db.UpdatePasswordParams{
		ID:           userID.(int32),
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "password updated"})
}

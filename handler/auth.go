package handler

import (
	"context"
	"net/http"
	"time"

	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

func (h *AuthHandler) roleCode(ctx context.Context, roleID int32) string {
	r, err := h.q.GetRoleByID(ctx, roleID)
	if err != nil {
		return ""
	}
	return r.Code
}

// POST /api/v1/auth/send-otp
type sendOTPReq struct {
	Phone   string `json:"phone" binding:"required"`
	Purpose string `json:"purpose" binding:"required,oneof=register login reset_password"`
}

func (h *AuthHandler) SendOTP(c *gin.Context) {
	var req sendOTPReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := randomOTP()
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	_, err = h.q.CreateOTPCode(context.Background(), db.CreateOTPCodeParams{
		Phone:     req.Phone,
		Code:      string(hash),
		Purpose:   req.Purpose,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(15 * time.Minute), Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Определяем telegram_chat_id если пользователь уже существует
	var chatID int64
	if u, err := h.q.GetUserByPhone(context.Background(), req.Phone); err == nil && u.TelegramChatID.Valid {
		chatID = u.TelegramChatID.Int64
	}
	_ = h.notifier.SendOTP(c.Request.Context(), req.Phone, chatID, code)

	c.JSON(http.StatusOK, gin.H{"message": "code sent"})
}

// POST /api/v1/auth/register
type registerReq struct {
	Phone      string `json:"phone" binding:"required"`
	Code       string `json:"code" binding:"required"`
	FirstName  string `json:"first_name" binding:"required"`
	LastName   string `json:"last_name" binding:"required"`
	MiddleName string `json:"middle_name"`
	City       string `json:"city"`
	RoleID     int32  `json:"role_id" binding:"required"`
	Password   string `json:"password"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	otp, err := h.q.GetActiveOTPCode(context.Background(), db.GetActiveOTPCodeParams{
		Phone:   req.Phone,
		Purpose: "register",
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired code"})
		return
	}

	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code"})
		return
	}
	_ = h.q.MarkOTPUsed(context.Background(), otp.ID)

	user, err := h.q.CreateUser(context.Background(), db.CreateUserParams{
		Phone:      req.Phone,
		FirstName:  req.FirstName,
		LastName:   req.LastName,
		MiddleName: pgtype.Text{String: req.MiddleName, Valid: req.MiddleName != ""},
		City:       pgtype.Text{String: req.City, Valid: req.City != ""},
		RoleID:     req.RoleID,
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "user already exists"})
		return
	}

	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err == nil {
			_ = h.q.UpdatePassword(context.Background(), db.UpdatePasswordParams{
				ID:           user.ID,
				PasswordHash: pgtype.Text{String: string(hash), Valid: true},
			})
		}
	}

	tokens, _, err := h.issueTokens(c, user.ID, h.roleCode(context.Background(), user.RoleID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusCreated, tokens)
}

// POST /api/v1/auth/login
type loginReq struct {
	Phone    string `json:"phone" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.q.GetUserByPhone(context.Background(), req.Phone)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if user.IsBanned {
		c.JSON(http.StatusForbidden, gin.H{"error": "user is banned"})
		return
	}
	if !user.PasswordHash.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "password not set, use OTP login"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	tokens, _, err := h.issueTokens(c, user.ID, h.roleCode(context.Background(), user.RoleID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, tokens)
}

// POST /api/v1/auth/refresh
type refreshReq struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claims, err := parseRefreshToken(req.RefreshToken, h.cfg.JWT.RefreshSecret)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	session, err := h.q.GetSessionByID(context.Background(), claims.SessionID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "session not found"})
		return
	}
	if session.RevokedAt.Valid || session.ExpiresAt.Time.Before(time.Now()) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "session expired or revoked"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(session.TokenHash), []byte(claims.Secret)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	_ = h.q.RevokeSession(context.Background(), session.ID)

	tokens, _, err := h.issueTokens(c, session.UserID, claims.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, tokens)
}

// POST /api/v1/auth/logout  (требует JWT middleware)
func (h *AuthHandler) Logout(c *gin.Context) {
	sessionID, _ := c.Get("session_id")
	id, ok := sessionID.(int32)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	_ = h.q.RevokeSession(context.Background(), id)
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// POST /api/v1/auth/login/otp
type loginOTPReq struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

func (h *AuthHandler) LoginOTP(c *gin.Context) {
	var req loginOTPReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.q.GetUserByPhone(context.Background(), req.Phone)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if user.IsBanned {
		c.JSON(http.StatusForbidden, gin.H{"error": "user is banned"})
		return
	}

	otp, err := h.q.GetActiveOTPCode(context.Background(), db.GetActiveOTPCodeParams{
		Phone:   req.Phone,
		Purpose: "login",
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired code"})
		return
	}
	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code"})
		return
	}
	_ = h.q.MarkOTPUsed(context.Background(), otp.ID)

	tokens, _, err := h.issueTokens(c, user.ID, h.roleCode(context.Background(), user.RoleID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, tokens)
}

// POST /api/v1/auth/reset-password
type resetPasswordReq struct {
	Phone    string `json:"phone" binding:"required"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required,min=8"`
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req resetPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	otp, err := h.q.GetActiveOTPCode(context.Background(), db.GetActiveOTPCodeParams{
		Phone:   req.Phone,
		Purpose: "reset_password",
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired code"})
		return
	}
	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code"})
		return
	}
	_ = h.q.MarkOTPUsed(context.Background(), otp.ID)

	user, err := h.q.GetUserByPhone(context.Background(), req.Phone)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user not found"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	_ = h.q.UpdatePassword(context.Background(), db.UpdatePasswordParams{
		ID:           user.ID,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	})
	_ = h.q.RevokeAllUserSessions(context.Background(), user.ID)

	tokens, _, err := h.issueTokens(c, user.ID, h.roleCode(context.Background(), user.RoleID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, tokens)
}

package handler

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"strings"
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

// getUserByPhone returns user by phone using raw query
func (h *AuthHandler) getUserByPhone(ctx context.Context, phone string) (db.User, error) {
	var u db.User
	err := h.pool.QueryRow(ctx, `
		SELECT id, phone, email, first_name, last_name, middle_name, city,
		       role_id, password_hash, telegram_chat_id, is_banned,
		       created_at, updated_at, profile_subject1, profile_subject2, avatar_url
		FROM users WHERE phone = $1
	`, phone).Scan(
		&u.ID, &u.Phone, &u.Email, &u.FirstName, &u.LastName, &u.MiddleName, &u.City,
		&u.RoleID, &u.PasswordHash, &u.TelegramChatID, &u.IsBanned,
		&u.CreatedAt, &u.UpdatedAt, &u.ProfileSubject1, &u.ProfileSubject2, &u.AvatarUrl,
	)
	return u, err
}

// getUserByEmail returns user by email using raw query
func (h *AuthHandler) getUserByEmail(ctx context.Context, email string) (db.User, error) {
	var u db.User
	err := h.pool.QueryRow(ctx, `
		SELECT id, phone, email, first_name, last_name, middle_name, city,
		       role_id, password_hash, telegram_chat_id, is_banned,
		       created_at, updated_at, profile_subject1, profile_subject2, avatar_url
		FROM users WHERE email = $1
	`, email).Scan(
		&u.ID, &u.Phone, &u.Email, &u.FirstName, &u.LastName, &u.MiddleName, &u.City,
		&u.RoleID, &u.PasswordHash, &u.TelegramChatID, &u.IsBanned,
		&u.CreatedAt, &u.UpdatedAt, &u.ProfileSubject1, &u.ProfileSubject2, &u.AvatarUrl,
	)
	return u, err
}

// getOTPByEmail returns active OTP for email
func (h *AuthHandler) getOTPByEmail(ctx context.Context, email, purpose string) (db.OtpCode, error) {
	var o db.OtpCode
	err := h.pool.QueryRow(ctx, `
		SELECT id, phone, email, code, purpose, attempts, is_used, expires_at, created_at
		FROM otp_codes
		WHERE email = $1
		  AND purpose = $2
		  AND is_used = FALSE
		  AND expires_at > NOW()
		ORDER BY created_at DESC
		LIMIT 1
	`, email, purpose).Scan(
		&o.ID, &o.Phone, &o.Email, &o.Code, &o.Purpose,
		&o.Attempts, &o.IsUsed, &o.ExpiresAt, &o.CreatedAt,
	)
	return o, err
}

// POST /api/v1/auth/send-otp
type sendOTPReq struct {
	Email   string `json:"email" binding:"required,email"`
	Purpose string `json:"purpose" binding:"required,oneof=register login reset_password"`
}

func (h *AuthHandler) SendOTP(c *gin.Context) {
	var req sendOTPReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите корректный email"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	// For login/reset_password — user must exist
	if req.Purpose == "login" || req.Purpose == "reset_password" {
		if _, err := h.getUserByEmail(context.Background(), req.Email); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь с таким email не найден"})
			return
		}
	}
	// For register — user must NOT exist
	if req.Purpose == "register" {
		if _, err := h.getUserByEmail(context.Background(), req.Email); err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "Email уже зарегистрирован"})
			return
		}
	}

	code := randomOTP4()
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	_, err = h.pool.Exec(context.Background(), `
		INSERT INTO otp_codes (email, code, purpose, expires_at)
		VALUES ($1, $2, $3, $4)
	`, req.Email, string(hash), req.Purpose,
		pgtype.Timestamptz{Time: time.Now().Add(15 * time.Minute), Valid: true},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if err := h.notifier.SendOTP(c.Request.Context(), req.Email, 0, code); err != nil {
		log.Printf("[OTP] send error for %s: %v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отправить код. Попробуйте позже."})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "code sent"})
}

// POST /api/v1/auth/register
type registerReq struct {
	Email     string `json:"email" binding:"required,email"`
	Code      string `json:"code" binding:"required"`
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	Password  string `json:"password" binding:"required,min=8"`
	RoleID    int32  `json:"role_id" binding:"required"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	// Verify OTP
	otp, err := h.getOTPByEmail(context.Background(), req.Email, "register")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный или истёкший код"})
		return
	}
	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Слишком много попыток"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный код"})
		return
	}
	_ = h.q.MarkOTPUsed(context.Background(), otp.ID)

	// Hash password
	pwHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Create user with email (phone = NULL)
	var u db.User
	err = h.pool.QueryRow(context.Background(), `
		INSERT INTO users (email, first_name, last_name, role_id, password_hash)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, phone, email, first_name, last_name, middle_name, city,
		          role_id, password_hash, telegram_chat_id, is_banned,
		          created_at, updated_at, profile_subject1, profile_subject2, avatar_url
	`, req.Email, req.FirstName, req.LastName, req.RoleID, string(pwHash)).Scan(
		&u.ID, &u.Phone, &u.Email, &u.FirstName, &u.LastName, &u.MiddleName, &u.City,
		&u.RoleID, &u.PasswordHash, &u.TelegramChatID, &u.IsBanned,
		&u.CreatedAt, &u.UpdatedAt, &u.ProfileSubject1, &u.ProfileSubject2, &u.AvatarUrl,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			c.JSON(http.StatusConflict, gin.H{"error": "Email уже зарегистрирован"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	tokens, _, err := h.issueTokens(c, u.ID, h.roleCode(context.Background(), u.RoleID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, tokens)
}

// POST /api/v1/auth/login
type loginReq struct {
	Identifier string `json:"identifier" binding:"required"` // email or phone
	Password   string `json:"password" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Identifier = strings.TrimSpace(req.Identifier)

	var user db.User
	var err error
	if strings.Contains(req.Identifier, "@") {
		user, err = h.getUserByEmail(context.Background(), strings.ToLower(req.Identifier))
	} else {
		user, err = h.getUserByPhone(context.Background(), req.Identifier)
	}
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный логин или пароль"})
		return
	}
	if user.IsBanned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Аккаунт заблокирован"})
		return
	}
	if !user.PasswordHash.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пароль не задан"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный email или пароль"})
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

// POST /api/v1/auth/logout
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
	Email string `json:"email" binding:"required,email"`
	Code  string `json:"code" binding:"required"`
}

func (h *AuthHandler) LoginOTP(c *gin.Context) {
	var req loginOTPReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	user, err := h.getUserByEmail(context.Background(), req.Email)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return
	}
	if user.IsBanned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Аккаунт заблокирован"})
		return
	}

	otp, err := h.getOTPByEmail(context.Background(), req.Email, "login")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный или истёкший код"})
		return
	}
	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Слишком много попыток"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный код"})
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
	Email    string `json:"email" binding:"required,email"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required,min=8"`
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req resetPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	otp, err := h.getOTPByEmail(context.Background(), req.Email, "reset_password")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный или истёкший код"})
		return
	}
	if otp.Attempts >= 3 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Слишком много попыток"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(otp.Code), []byte(req.Code)); err != nil {
		_ = h.q.IncrementOTPAttempts(context.Background(), otp.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный код"})
		return
	}
	_ = h.q.MarkOTPUsed(context.Background(), otp.ID)

	user, err := h.getUserByEmail(context.Background(), req.Email)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пользователь не найден"})
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

// randomOTP4 returns a 4-digit code
func randomOTP4() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	n := (int(b[0])<<8 | int(b[1])) % 10000
	if n < 0 {
		n = -n
	}
	return fmt.Sprintf("%04d", n)
}

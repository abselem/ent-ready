package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type AccessClaims struct {
	UserID    int32  `json:"user_id"`
	SessionID int32  `json:"session_id"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

type RefreshClaims struct {
	SessionID int32  `json:"session_id"`
	Secret    string `json:"secret"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

func (h *AuthHandler) issueTokens(c *gin.Context, userID int32, roleCode string) (TokenPair, db.Session, error) {
	secret := randomHex(32)

	hash, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		return TokenPair{}, db.Session{}, err
	}

	expiresAt := time.Now().Add(h.cfg.JWT.RefreshTTL)
	session, err := h.q.CreateSession(context.Background(), db.CreateSessionParams{
		UserID:     userID,
		TokenHash:  string(hash),
		DeviceInfo: pgtype.Text{String: c.GetHeader("User-Agent"), Valid: true},
		Ip:         pgtype.Text{String: c.ClientIP(), Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return TokenPair{}, db.Session{}, err
	}

	accessToken, err := buildToken(AccessClaims{
		UserID:    userID,
		SessionID: session.ID,
		Role:      roleCode,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(h.cfg.JWT.AccessTTL)),
		},
	}, h.cfg.JWT.AccessSecret)
	if err != nil {
		return TokenPair{}, db.Session{}, err
	}

	refreshToken, err := buildToken(RefreshClaims{
		SessionID: session.ID,
		Secret:    secret,
		Role:      roleCode,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}, h.cfg.JWT.RefreshSecret)
	if err != nil {
		return TokenPair{}, db.Session{}, err
	}

	return TokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, session, nil
}

func parseRefreshToken(tokenStr, secret string) (*RefreshClaims, error) {
	var claims RefreshClaims
	t, err := jwt.ParseWithClaims(tokenStr, &claims, func(*jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !t.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return &claims, nil
}

func buildToken(claims jwt.Claims, secret string) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func randomOTP() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	n := (int(b[0])<<16 | int(b[1])<<8 | int(b[2])) % 1_000_000
	return fmt.Sprintf("%06d", n)
}

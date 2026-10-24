package middleware

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type accessClaims struct {
	UserID    int32  `json:"user_id"`
	SessionID int32  `json:"session_id"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

func JWT(secret string, pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		var claims accessClaims
		t, err := jwt.ParseWithClaims(h[7:], &claims, func(*jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
		if err != nil || !t.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		var role string
		err = pool.QueryRow(c.Request.Context(), `SELECT r.code FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.is_banned=FALSE`, claims.SessionID, claims.UserID).Scan(&role)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session inactive"})
			return
		}
		claims.Role = role
		c.Set("user_id", claims.UserID)
		c.Set("session_id", claims.SessionID)
		c.Set("role", claims.Role)
		c.Next()
	}
}

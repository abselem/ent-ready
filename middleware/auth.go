package middleware

import (
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

func JWT(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		var claims accessClaims
		t, err := jwt.ParseWithClaims(h[7:], &claims, func(*jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !t.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("session_id", claims.SessionID)
		c.Set("role", claims.Role)
		c.Next()
	}
}

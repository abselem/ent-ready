package handler

import (
	"strconv"

	"testing-app/config"
	db "testing-app/db/sqlc"
	"testing-app/middleware"
	"testing-app/notify"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AuthHandler struct {
	q        db.Querier
	pool     *pgxpool.Pool
	cfg      *config.Config
	notifier notify.Sender
	rl       *middleware.RateLimiter
}

func NewAuthHandler(pool *pgxpool.Pool, cfg *config.Config, n notify.Sender, rl *middleware.RateLimiter) *AuthHandler {
	return &AuthHandler{
		q:        db.New(pool),
		pool:     pool,
		cfg:      cfg,
		notifier: n,
		rl:       rl,
	}
}

// parsePagination reads ?limit=N&offset=N from the request.
// Default: limit=50, offset=0. Max limit: 200.
func parsePagination(c *gin.Context) (limit, offset int32) {
	limit = 50
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "50")); err == nil && l > 0 {
		if l > 200 {
			l = 200
		}
		limit = int32(l)
	}
	if o, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil && o >= 0 {
		offset = int32(o)
	}
	return
}

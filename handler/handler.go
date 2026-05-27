package handler

import (
	"testing-app/config"
	db "testing-app/db/sqlc"
	"testing-app/notify"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuthHandler struct {
	q        db.Querier
	pool     *pgxpool.Pool
	cfg      *config.Config
	notifier notify.Sender
}

func NewAuthHandler(pool *pgxpool.Pool, cfg *config.Config, n notify.Sender) *AuthHandler {
	return &AuthHandler{
		q:        db.New(pool),
		pool:     pool,
		cfg:      cfg,
		notifier: n,
	}
}

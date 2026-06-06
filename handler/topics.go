package handler

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "testing-app/db/sqlc"
)

type TopicHandler struct {
	q    db.Querier
	pool *pgxpool.Pool
}

func NewTopicHandler(pool *pgxpool.Pool) *TopicHandler {
	return &TopicHandler{q: db.New(pool), pool: pool}
}

// GET /api/v1/topics/:id/tests
// Public published tests for a topic with author name.
func (h *TopicHandler) ListTests(c *gin.Context) {
	topicID, err := parseID(c, "id")
	if err != nil {
		return
	}
	ctx := context.Background()

	type testRow struct {
		ID          int32   `json:"id"`
		Title       string  `json:"title"`
		Description string  `json:"description"`
		MaxAttempts int16   `json:"max_attempts"`
		TimeLimit   *int16  `json:"time_limit"`
		AuthorName  string  `json:"author_name"`
	}

	rows, err := h.pool.Query(ctx, `
		SELECT t.id, t.title, COALESCE(t.description,''), t.max_attempts, t.time_limit,
		       CASE WHEN u.id IS NOT NULL THEN TRIM(u.first_name || ' ' || u.last_name)
		            ELSE 'Сгенерированный AI' END AS author_name
		FROM tests t
		LEFT JOIN users u ON u.id = t.created_by
		WHERE t.is_published = TRUE AND t.is_public = TRUE AND t.topic_id = $1
		ORDER BY t.created_at DESC
	`, topicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	tests := []testRow{}
	for rows.Next() {
		var t testRow
		var tl pgtype.Int2
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &t.MaxAttempts, &tl, &t.AuthorName); err != nil {
			continue
		}
		if tl.Valid {
			v := tl.Int16
			t.TimeLimit = &v
		}
		tests = append(tests, t)
	}
	c.JSON(http.StatusOK, tests)
}

// POST /api/v1/topics/:id/random-test
// Creates a random 20-question test (7 easy + 7 medium + 6 hard) and returns {test_id}.
func (h *TopicHandler) StartRandomTest(c *gin.Context) {
	topicID, err := parseID(c, "id")
	if err != nil {
		return
	}
	ctx := context.Background()

	var topicName string
	if err := h.pool.QueryRow(ctx, `SELECT name FROM topics WHERE id=$1`, topicID).Scan(&topicName); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "topic not found"})
		return
	}

	type qRow struct {
		id     int32
		points int16
	}
	var questions []qRow
	targets := []struct{ diff, count int }{{1, 7}, {2, 7}, {3, 6}}
	for _, t := range targets {
		rows, err := h.pool.Query(ctx, `
			SELECT id, points FROM questions
			WHERE topic_id=$1 AND difficulty=$2
			ORDER BY RANDOM()
			LIMIT $3
		`, topicID, t.diff, t.count)
		if err != nil {
			continue
		}
		for rows.Next() {
			var q qRow
			if rows.Scan(&q.id, &q.points) == nil {
				questions = append(questions, q)
			}
		}
		rows.Close()
	}

	if len(questions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no questions available for this topic"})
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer tx.Rollback(ctx)

	var testID int32
	err = tx.QueryRow(ctx, `
		INSERT INTO tests (title, is_published, is_public, max_attempts, topic_id)
		VALUES ($1, TRUE, FALSE, 1, $2)
		RETURNING id
	`, fmt.Sprintf("Случайный тест: %s", topicName), topicID).Scan(&testID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	for i, q := range questions {
		if _, err := tx.Exec(ctx, `
			INSERT INTO test_questions (test_id, question_id, order_num) VALUES ($1, $2, $3)
		`, testID, q.id, i+1); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"test_id": testID})
}

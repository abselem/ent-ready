package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ActivityHandler struct {
	pool *pgxpool.Pool
}

func NewActivityHandler(pool *pgxpool.Pool) *ActivityHandler {
	return &ActivityHandler{pool: pool}
}

type dayEntry struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// GET /api/v1/users/me/activity
func (h *ActivityHandler) GetActivity(c *gin.Context) {
	userID, _ := c.Get("user_id")
	ctx := context.Background()

	// Daily counts for past year
	rows, err := h.pool.Query(ctx, `
		SELECT date_trunc('day', finished_at AT TIME ZONE 'UTC')::date AS day,
		       COUNT(*) AS cnt
		FROM test_attempts
		WHERE user_id = $1 AND finished_at IS NOT NULL
		  AND finished_at >= NOW() - INTERVAL '1 year'
		GROUP BY day
	`, userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer rows.Close()

	dayMap := map[string]int{}
	for rows.Next() {
		var day time.Time
		var cnt int
		if rows.Scan(&day, &cnt) == nil {
			dayMap[day.UTC().Format("2006-01-02")] = cnt
		}
	}

	// Total attempts ever
	var totalSolved int64
	h.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM test_attempts
		WHERE user_id = $1 AND finished_at IS NOT NULL
	`, userID.(int32)).Scan(&totalSolved)

	// Build 365-day array ending today
	today := time.Now().UTC().Truncate(24 * time.Hour)
	days := make([]dayEntry, 365)
	for i := 0; i < 365; i++ {
		d := today.AddDate(0, 0, -(364 - i))
		ds := d.Format("2006-01-02")
		days[i] = dayEntry{Date: ds, Count: dayMap[ds]}
	}

	// Current streak (consecutive days with activity ending today or yesterday)
	currentStreak := 0
	for i := 364; i >= 0; i-- {
		if days[i].Count > 0 {
			currentStreak++
		} else {
			break
		}
	}

	// Max streak over the full year
	maxStreak, run := 0, 0
	for _, d := range days {
		if d.Count > 0 {
			run++
			if run > maxStreak {
				maxStreak = run
			}
		} else {
			run = 0
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"days":           days,
		"current_streak": currentStreak,
		"max_streak":     maxStreak,
		"total_solved":   totalSolved,
	})
}

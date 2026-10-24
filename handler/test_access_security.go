package handler

import (
	"context"
	db "testing-app/db/sqlc"
	"time"
)

// Generated tests are personal even if flags are accidentally changed later.
func (h *TestHandler) canReadTest(ctx context.Context, test db.Test, userID int32) bool {
	var allowed bool
	err := h.pool.QueryRow(ctx, `SELECT CASE WHEN generated_for IS NOT NULL THEN generated_for=$2 ELSE COALESCE(created_by=$2,FALSE) OR (is_published AND (is_public OR EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=tests.group_id AND ug.user_id=$2))) END FROM tests WHERE id=$1`, test.ID, userID).Scan(&allowed)
	return err == nil && allowed
}
func attemptExpired(test db.Test, attempt db.TestAttempt, now time.Time) bool {
	if test.Deadline.Valid && !now.Before(test.Deadline.Time) {
		return true
	}
	return test.TimeLimit.Valid && attempt.StartedAt.Valid && !now.Before(attempt.StartedAt.Time.Add(time.Duration(test.TimeLimit.Int16)*time.Minute))
}

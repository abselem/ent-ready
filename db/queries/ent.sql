-- ── ent_attempts ─────────────────────────────────────────────────────────────

-- name: CreateENTAttempt :one
INSERT INTO ent_attempts (user_id, subject3_id, subject4_id)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetENTAttemptByID :one
SELECT * FROM ent_attempts WHERE id = $1;

-- name: FinishENTAttempt :one
UPDATE ent_attempts
SET finished_at = NOW(), score1 = $2, score2 = $3, score3 = $4, score4 = $5
WHERE id = $1
RETURNING *;

-- name: GetMyENTAttempts :many
SELECT * FROM ent_attempts WHERE user_id = $1 ORDER BY started_at DESC;

-- ── ent_attempt_questions ─────────────────────────────────────────────────────

-- name: InsertENTQuestion :exec
INSERT INTO ent_attempt_questions (attempt_id, question_id, slot, order_num)
VALUES ($1, $2, $3, $4);

-- name: GetENTAttemptQuestions :many
SELECT * FROM ent_attempt_questions WHERE attempt_id = $1 ORDER BY slot, order_num;

-- ── ent_selected_options ──────────────────────────────────────────────────────

-- name: ClearENTAnswersForQuestion :exec
DELETE FROM ent_selected_options WHERE attempt_id = $1 AND question_id = $2;

-- name: InsertENTSelectedOption :exec
INSERT INTO ent_selected_options (attempt_id, question_id, option_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetENTSelectedOptions :many
SELECT * FROM ent_selected_options WHERE attempt_id = $1;

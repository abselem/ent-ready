-- name: CreateLesson :one
INSERT INTO lessons (group_id, title, description, scheduled_at, duration_min)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetLessonByID :one
SELECT * FROM lessons WHERE id = $1;

-- name: GetLessonsByGroup :many
SELECT * FROM lessons
WHERE group_id = $1
ORDER BY scheduled_at
LIMIT $2 OFFSET $3;

-- name: UpdateLesson :one
UPDATE lessons
SET title = $2, description = $3, scheduled_at = $4, duration_min = $5
WHERE id = $1
RETURNING *;

-- name: DeleteLesson :exec
DELETE FROM lessons WHERE id = $1;

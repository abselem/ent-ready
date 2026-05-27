-- name: CreateSession :one
INSERT INTO sessions (user_id, token_hash, device_info, ip, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetSessionByID :one
SELECT * FROM sessions WHERE id = $1;

-- name: GetActiveSessionsByUser :many
SELECT * FROM sessions
WHERE user_id = $1
  AND revoked_at IS NULL
  AND expires_at > NOW()
ORDER BY created_at DESC;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = NOW() WHERE id = $1;

-- name: RevokeAllUserSessions :exec
UPDATE sessions SET revoked_at = NOW()
WHERE user_id = $1 AND revoked_at IS NULL;

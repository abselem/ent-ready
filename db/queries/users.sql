-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: CreateUser :one
INSERT INTO users (phone, first_name, last_name, middle_name, city, role_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateTelegramChatID :exec
UPDATE users SET telegram_chat_id = $2 WHERE id = $1;

-- name: UpdatePassword :exec
UPDATE users SET password_hash = $2 WHERE id = $1;

-- name: UpdateRole :exec
UPDATE users SET role_id = $2 WHERE id = $1;

-- name: BanUser :exec
UPDATE users SET is_banned = TRUE WHERE id = $1;

-- name: UnbanUser :exec
UPDATE users SET is_banned = FALSE WHERE id = $1;

-- name: UpdateUserProfile :one
UPDATE users
SET first_name = $2, last_name = $3, middle_name = $4, city = $5,
    profile_subject1 = $6, profile_subject2 = $7
WHERE id = $1
RETURNING *;

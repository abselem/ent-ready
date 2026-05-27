-- name: CreateGroup :one
INSERT INTO groups (name, city, school, teacher_id, invite_code)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetGroupByID :one
SELECT * FROM groups WHERE id = $1;

-- name: GetGroupsByTeacher :many
SELECT * FROM groups WHERE teacher_id = $1 ORDER BY created_at DESC;

-- name: GetGroupByIdentity :one
SELECT * FROM groups WHERE city = $1 AND school = $2 AND name = $3;

-- name: GetGroupByCode :one
SELECT * FROM groups WHERE invite_code = $1;

-- name: GetGroupsByUser :many
SELECT g.* FROM groups g
JOIN user_groups ug ON ug.group_id = g.id
WHERE ug.user_id = $1
ORDER BY ug.joined_at;

-- name: CountUserGroups :one
SELECT COUNT(*) FROM user_groups WHERE user_id = $1;

-- name: AddStudentToGroup :one
INSERT INTO user_groups (user_id, group_id)
VALUES ($1, $2)
RETURNING *;

-- name: GetStudentsByGroup :many
SELECT u.* FROM users u
JOIN user_groups ug ON ug.user_id = u.id
WHERE ug.group_id = $1
ORDER BY u.last_name, u.first_name;

-- name: RemoveStudentFromGroup :exec
DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2;

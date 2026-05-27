-- name: GetRoleByID :one
SELECT * FROM roles WHERE id = $1;

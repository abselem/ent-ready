-- name: CreateOrganization :one
INSERT INTO organizations (name, timezone, locale, grading_scale)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: CreateOrganizationOwner :exec
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, 'owner');

-- name: ListOrganizationsForUser :many
SELECT o.*, m.role FROM organizations o
JOIN organization_members m ON m.organization_id = o.id
WHERE m.user_id = $1 AND m.status = 'active'
ORDER BY o.created_at, o.id;

-- name: GetOrganizationForMember :one
SELECT o.*, m.role FROM organizations o
JOIN organization_members m ON m.organization_id = o.id
WHERE o.id = $1 AND m.user_id = $2 AND m.status = 'active';

-- name: UpdateOrganizationForManager :one
UPDATE organizations o SET name = COALESCE(sqlc.narg(name)::text, o.name),
    timezone = COALESCE(sqlc.narg(timezone)::text, o.timezone),
    locale = COALESCE(sqlc.narg(locale)::text, o.locale),
    grading_scale = COALESCE(sqlc.narg(grading_scale)::text, o.grading_scale), updated_at = NOW()
WHERE o.id = $1 AND EXISTS (
    SELECT 1 FROM organization_members m WHERE m.organization_id = o.id
    AND m.user_id = $2 AND m.status = 'active' AND m.role IN ('owner', 'admin')
) RETURNING o.*;

-- name: ListOrganizationMembers :many
SELECT m.user_id, u.first_name, u.last_name, m.role, m.joined_at
FROM organization_members m JOIN users u ON u.id = m.user_id
WHERE m.organization_id = $1 AND m.status = 'active'
AND EXISTS (
    SELECT 1 FROM organization_members actor WHERE actor.organization_id = m.organization_id
    AND actor.user_id = $2 AND actor.status = 'active' AND actor.role IN ('owner', 'admin')
)
ORDER BY m.joined_at, m.user_id;

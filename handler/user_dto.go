package handler

import db "testing-app/db/sqlc"

// Explicit allowlist: storage-only credentials never belong in API responses.
func userResponse(u db.User) map[string]any {
	return map[string]any{
		"id": u.ID, "phone": u.Phone, "email": u.Email, "first_name": u.FirstName,
		"last_name": u.LastName, "middle_name": u.MiddleName, "city": u.City, "role_id": u.RoleID,
		"is_banned": u.IsBanned, "created_at": u.CreatedAt, "updated_at": u.UpdatedAt,
		"profile_subject1": u.ProfileSubject1, "profile_subject2": u.ProfileSubject2, "avatar_url": u.AvatarUrl,
	}
}

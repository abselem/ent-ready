package handler

import (
	"github.com/jackc/pgx/v5/pgtype"
	db "testing-app/db/sqlc"
)

type studentSummary struct {
	ID        int32       `json:"id"`
	FirstName string      `json:"first_name"`
	LastName  string      `json:"last_name"`
	AvatarURL pgtype.Text `json:"avatar_url"`
}

func groupResponse(g db.Group, owner bool) map[string]any {
	result := map[string]any{"id": g.ID, "name": g.Name, "city": g.City, "school": g.School, "teacher_id": g.TeacherID, "category": g.Category, "created_at": g.CreatedAt, "updated_at": g.UpdatedAt}
	if owner {
		result["invite_code"] = g.InviteCode
	}
	return result
}

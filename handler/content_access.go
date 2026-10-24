package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

func validLessonVisibility(v string) bool {
	return v == "all" || v == "school" || v == "course" || v == "private"
}

// requireGroupRead deliberately hides group existence from outsiders.
func requireGroupRead(c *gin.Context, pool *pgxpool.Pool, id int32, ownerOnly bool) bool {
	var allowed bool
	uid, _ := c.Get("user_id")
	err := pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM groups g WHERE g.id=$1 AND
 (g.teacher_id=$2 OR (NOT $3 AND EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=g.id AND ug.user_id=$2))))`, id, uid.(int32), ownerOnly).Scan(&allowed)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return false
	}
	if !allowed {
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return false
	}
	return true
}

// The same predicate is used for both listing and direct reads. Group membership
// is an independent grant, matching the existing catalogue semantics.
const lessonReadPredicate = `(l.created_by=$1 OR (l.is_published AND (
 l.visibility='all'
 OR EXISTS(SELECT 1 FROM user_groups ug WHERE ug.user_id=$1 AND ug.group_id=l.group_id)
 OR (l.visibility IN ('school','course') AND EXISTS(SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id WHERE ug.user_id=$1 AND g.category=l.visibility AND g.teacher_id=l.created_by))
 OR (l.visibility='private' AND (EXISTS(SELECT 1 FROM lesson_access a WHERE a.lesson_id=l.id AND a.type='student' AND a.ref_id=$1)
 OR EXISTS(SELECT 1 FROM lesson_access a JOIN user_groups ug ON ug.group_id=a.ref_id WHERE a.lesson_id=l.id AND a.type='group' AND ug.user_id=$1)))
 )))`

func (h *LessonHandler) requireLessonRead(c *gin.Context, id int32) bool {
	uid, _ := c.Get("user_id")
	var allowed bool
	err := h.pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM lessons l WHERE l.id=$2 AND `+lessonReadPredicate+`)`, uid.(int32), id).Scan(&allowed)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return false
	}
	if !allowed {
		c.JSON(http.StatusNotFound, gin.H{"error": "lesson not found"})
		return false
	}
	return true
}

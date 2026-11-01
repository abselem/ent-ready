package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"

	db "testing-app/db/organizationsqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OrganizationHandler struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewOrganizationHandler(pool *pgxpool.Pool) *OrganizationHandler {
	return &OrganizationHandler{pool: pool, q: db.New(pool)}
}

type organizationSettings struct {
	Name         string `json:"name"`
	Timezone     string `json:"timezone"`
	Locale       string `json:"locale"`
	GradingScale string `json:"grading_scale"`
}

// Decode a bounded, strict partial object: null is not a meaningful setting.
func readOrganizationSettings(c *gin.Context, settings *organizationSettings, create bool, fields map[string]json.RawMessage) bool {
	dec := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	if err := dec.Decode(&fields); err != nil || len(fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization settings"})
		return false
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization settings"})
		return false
	}
	allowed := map[string]*string{"name": &settings.Name, "timezone": &settings.Timezone, "locale": &settings.Locale, "grading_scale": &settings.GradingScale}
	for key, raw := range fields {
		target, ok := allowed[key]
		if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, target) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization settings"})
			return false
		}
	}
	settings.Name = strings.TrimSpace(settings.Name)
	_, hasName := fields["name"]
	if (create && !hasName) || utf8.RuneCountInString(settings.Name) < 1 || utf8.RuneCountInString(settings.Name) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name must contain 1 to 120 characters"})
		return false
	}
	if settings.Timezone == "" || settings.Timezone == "Local" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid timezone"})
		return false
	}
	if _, err := time.LoadLocation(settings.Timezone); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid timezone"})
		return false
	}
	if settings.Locale != "ru" && settings.Locale != "kk" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid locale"})
		return false
	}
	switch settings.GradingScale {
	case "points", "5", "10", "100":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid grading_scale"})
		return false
	}
	return true
}

func (h *OrganizationHandler) List(c *gin.Context) {
	rows, err := h.q.ListOrganizationsForUser(c.Request.Context(), c.GetInt32("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, rows)
}

func (h *OrganizationHandler) Create(c *gin.Context) {
	if c.GetString("role") != "teacher" {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		return
	}
	settings := organizationSettings{Timezone: "Asia/Qyzylorda", Locale: "ru", GradingScale: "points"}
	if !readOrganizationSettings(c, &settings, true, make(map[string]json.RawMessage)) {
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	org, err := q.CreateOrganization(ctx, db.CreateOrganizationParams{Name: settings.Name, Timezone: settings.Timezone, Locale: settings.Locale, GradingScale: settings.GradingScale})
	if err == nil {
		err = q.CreateOrganizationOwner(ctx, db.CreateOrganizationOwnerParams{OrganizationID: org.ID, UserID: c.GetInt32("user_id")})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": org.ID, "name": org.Name, "timezone": org.Timezone, "locale": org.Locale, "grading_scale": org.GradingScale, "role": "owner", "created_at": org.CreatedAt, "updated_at": org.UpdatedAt})
}

func (h *OrganizationHandler) memberOrganization(c *gin.Context, manager bool) (db.GetOrganizationForMemberRow, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 32)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization id"})
		return db.GetOrganizationForMemberRow{}, false
	}
	org, err := h.q.GetOrganizationForMember(c.Request.Context(), db.GetOrganizationForMemberParams{ID: int32(id), UserID: c.GetInt32("user_id")})
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return org, false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return org, false
	}
	if manager && org.Role != "owner" && org.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		return org, false
	}
	return org, true
}

func (h *OrganizationHandler) Get(c *gin.Context) {
	org, ok := h.memberOrganization(c, false)
	if ok {
		c.JSON(http.StatusOK, org)
	}
}

func (h *OrganizationHandler) Update(c *gin.Context) {
	org, ok := h.memberOrganization(c, true)
	if !ok {
		return
	}
	settings := organizationSettings{Name: org.Name, Timezone: org.Timezone, Locale: org.Locale, GradingScale: org.GradingScale}
	fields := make(map[string]json.RawMessage)
	if !readOrganizationSettings(c, &settings, false, fields) {
		return
	}
	provided := func(key, value string) pgtype.Text {
		_, exists := fields[key]
		return pgtype.Text{String: value, Valid: exists}
	}
	updated, err := h.q.UpdateOrganizationForManager(c.Request.Context(), db.UpdateOrganizationForManagerParams{ID: org.ID, UserID: c.GetInt32("user_id"), Name: provided("name", settings.Name), Timezone: provided("timezone", settings.Timezone), Locale: provided("locale", settings.Locale), GradingScale: provided("grading_scale", settings.GradingScale)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": updated.ID, "name": updated.Name, "timezone": updated.Timezone, "locale": updated.Locale, "grading_scale": updated.GradingScale, "role": org.Role, "created_at": updated.CreatedAt, "updated_at": updated.UpdatedAt})
}

func (h *OrganizationHandler) Members(c *gin.Context) {
	org, ok := h.memberOrganization(c, true)
	if !ok {
		return
	}
	rows, err := h.q.ListOrganizationMembers(c.Request.Context(), db.ListOrganizationMembersParams{OrganizationID: org.ID, UserID: c.GetInt32("user_id")})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, rows)
}

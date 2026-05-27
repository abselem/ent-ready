package handler

import (
	"context"
	"net/http"
	"time"

	"testing-app/config"
	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TestHandler struct {
	q db.Querier
}

func NewTestHandler(pool *pgxpool.Pool, _ *config.Config) *TestHandler {
	return &TestHandler{q: db.New(pool)}
}

// ═══════════════════════════════════════════════════════════════════════════
// УЧИТЕЛЬ — управление тестом
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/v1/tests  (group_id опционален в теле)
// POST /api/v1/groups/:id/tests  (group_id берётся из URL)
type createTestReq struct {
	Title       string  `json:"title" binding:"required"`
	Description string  `json:"description"`
	TimeLimit   *int16  `json:"time_limit"`
	MaxAttempts int16   `json:"max_attempts"`
	IsPublic    bool    `json:"is_public"`
	GroupID     *int32  `json:"group_id"`
	Deadline    *string `json:"deadline"` // RFC3339, nil = без дедлайна
	TopicID     *int32  `json:"topic_id"`
}

func (h *TestHandler) CreateTest(c *gin.Context) {
	var req createTestReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxAttempts == 0 {
		req.MaxAttempts = 1
	}

	var groupID pgtype.Int4
	if idStr := c.Param("id"); idStr != "" {
		gid, err := parseID(c, "id")
		if err != nil {
			return
		}
		groupID = pgtype.Int4{Int32: gid, Valid: true}
	} else if req.GroupID != nil {
		groupID = pgtype.Int4{Int32: *req.GroupID, Valid: true}
	}

	var timeLimit pgtype.Int2
	if req.TimeLimit != nil {
		timeLimit = pgtype.Int2{Int16: *req.TimeLimit, Valid: true}
	}

	var deadline pgtype.Timestamptz
	if req.Deadline != nil && *req.Deadline != "" {
		if t, err := time.Parse(time.RFC3339, *req.Deadline); err == nil {
			deadline = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}

	var topicID pgtype.Int4
	if req.TopicID != nil {
		topicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}

	userID, _ := c.Get("user_id")
	test, err := h.q.CreateTest(context.Background(), db.CreateTestParams{
		GroupID:     groupID,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		TimeLimit:   timeLimit,
		MaxAttempts: req.MaxAttempts,
		IsPublic:    req.IsPublic,
		CreatedBy:   pgtype.Int4{Int32: userID.(int32), Valid: true},
		Deadline:    deadline,
		TopicID:     topicID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, test)
}

// canSeeResults — могут ли студенты видеть подробные ответы
// Публичный тест: всегда да. Групповой: дедлайн прошёл ИЛИ все сдали.
func (h *TestHandler) canSeeResults(ctx context.Context, test db.Test) bool {
	if test.IsPublic || !test.GroupID.Valid {
		return true
	}
	// Дедлайн прошёл?
	if test.Deadline.Valid && time.Now().After(test.Deadline.Time) {
		return true
	}
	// Все студенты группы сдали?
	total, _ := h.q.CountGroupStudents(ctx, test.GroupID.Int32)
	finished, _ := h.q.CountFinishedAttempts(ctx, test.ID)
	return total > 0 && finished >= total
}

// PUT /api/v1/tests/:id
type updateTestReq struct {
	Title       string  `json:"title" binding:"required"`
	Description string  `json:"description"`
	TimeLimit   *int16  `json:"time_limit"`
	MaxAttempts int16   `json:"max_attempts"`
	IsPublic    bool    `json:"is_public"`
	Deadline    *string `json:"deadline"`
	TopicID     *int32  `json:"topic_id"`
}

func (h *TestHandler) UpdateTest(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req updateTestReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxAttempts == 0 {
		req.MaxAttempts = 1
	}

	var timeLimit pgtype.Int2
	if req.TimeLimit != nil {
		timeLimit = pgtype.Int2{Int16: *req.TimeLimit, Valid: true}
	}

	var deadline pgtype.Timestamptz
	if req.Deadline != nil && *req.Deadline != "" {
		if t, err := time.Parse(time.RFC3339, *req.Deadline); err == nil {
			deadline = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}

	var updateTopicID pgtype.Int4
	if req.TopicID != nil {
		updateTopicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}

	test, err := h.q.UpdateTest(context.Background(), db.UpdateTestParams{
		ID:          id,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		TimeLimit:   timeLimit,
		MaxAttempts: req.MaxAttempts,
		IsPublic:    req.IsPublic,
		Deadline:    deadline,
		TopicID:     updateTopicID,
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test not found"})
		return
	}
	c.JSON(http.StatusOK, test)
}

// POST /api/v1/tests/:id/publish
func (h *TestHandler) PublishTest(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	if err := h.q.PublishTest(context.Background(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "published"})
}

// DELETE /api/v1/tests/:id
func (h *TestHandler) DeleteTest(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	_ = h.q.DeleteTest(context.Background(), id)
	c.Status(http.StatusNoContent)
}

// POST /api/v1/tests/:id/questions
type createQuestionReq struct {
	Text        string  `json:"text" binding:"required"`
	OrderNum    int16   `json:"order_num"`
	Points      int16   `json:"points"`
	TopicID     *int32  `json:"topic_id"`
	SubtopicID  *int32  `json:"subtopic_id"`
	Explanation *string `json:"explanation"`
	Difficulty  int16   `json:"difficulty"` // 1=легкий 2=средний 3=сложный
}

// POST /api/v1/tests/:id/questions — создать вопрос в банке и добавить в тест
func (h *TestHandler) CreateQuestion(c *gin.Context) {
	ctx := context.Background()
	testID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")
	var req createQuestionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Points == 0 {
		req.Points = 1
	}

	count, _ := h.q.CountQuestionsInTest(ctx, int32(testID))
	diff := req.Difficulty
	if diff < 1 || diff > 3 {
		diff = 1
	}
	params := db.CreateQuestionParams{
		Text:       req.Text,
		OrderNum:   int16(count),
		Points:     req.Points,
		OwnerID:    pgtype.Int4{Int32: userID.(int32), Valid: true},
		Difficulty: diff,
	}
	if req.TopicID != nil {
		params.TopicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}
	if req.SubtopicID != nil {
		params.SubtopicID = pgtype.Int4{Int32: *req.SubtopicID, Valid: true}
	}
	if req.Explanation != nil && *req.Explanation != "" {
		params.Explanation = pgtype.Text{String: *req.Explanation, Valid: true}
	}

	q, err := h.q.CreateQuestion(ctx, params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	_ = h.q.AddQuestionToTest(ctx, db.AddQuestionToTestParams{
		TestID: testID, QuestionID: q.ID, OrderNum: int16(count),
	})
	c.JSON(http.StatusCreated, q)
}

// POST /api/v1/questions — создать вопрос в банке без привязки к тесту
func (h *TestHandler) CreateBankQuestion(c *gin.Context) {
	ctx := context.Background()
	userID, _ := c.Get("user_id")
	var req createQuestionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Points == 0 {
		req.Points = 1
	}
	bdiff := req.Difficulty
	if bdiff < 1 || bdiff > 3 {
		bdiff = 1
	}
	params := db.CreateQuestionParams{
		Text:       req.Text,
		OrderNum:   req.OrderNum,
		Points:     req.Points,
		OwnerID:    pgtype.Int4{Int32: userID.(int32), Valid: true},
		Difficulty: bdiff,
	}
	if req.TopicID != nil {
		params.TopicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}
	if req.SubtopicID != nil {
		params.SubtopicID = pgtype.Int4{Int32: *req.SubtopicID, Valid: true}
	}
	if req.Explanation != nil && *req.Explanation != "" {
		params.Explanation = pgtype.Text{String: *req.Explanation, Valid: true}
	}
	q, err := h.q.CreateQuestion(ctx, params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, q)
}

// GET /api/v1/questions/mine — банк вопросов учителя
func (h *TestHandler) ListMyQuestions(c *gin.Context) {
	userID, _ := c.Get("user_id")
	rows, err := h.q.GetMyQuestions(context.Background(), pgtype.Int4{Int32: userID.(int32), Valid: true})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, rows)
}

// POST /api/v1/tests/:id/questions/link — добавить существующий вопрос из банка
type linkQuestionReq struct {
	QuestionID int32 `json:"question_id" binding:"required"`
}

func (h *TestHandler) LinkQuestionToTest(c *gin.Context) {
	ctx := context.Background()
	testID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req linkQuestionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	count, _ := h.q.CountQuestionsInTest(ctx, testID)
	err = h.q.AddQuestionToTest(ctx, db.AddQuestionToTestParams{
		TestID: testID, QuestionID: req.QuestionID, OrderNum: int16(count),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DELETE /api/v1/tests/:id/questions/:qid — убрать вопрос из теста (не удалять из банка)
func (h *TestHandler) UnlinkQuestionFromTest(c *gin.Context) {
	testID, err := parseID(c, "id")
	if err != nil {
		return
	}
	qid, err := parseID(c, "qid")
	if err != nil {
		return
	}
	_ = h.q.RemoveQuestionFromTest(context.Background(), db.RemoveQuestionFromTestParams{
		TestID: testID, QuestionID: qid,
	})
	c.Status(http.StatusNoContent)
}

// GET /api/v1/topics
func (h *TestHandler) ListTopics(c *gin.Context) {
	topics, err := h.q.GetTopics(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, topics)
}

// POST /api/v1/topics
type createTopicReq struct {
	Name string `json:"name" binding:"required"`
}

func (h *TestHandler) CreateTopic(c *gin.Context) {
	var req createTopicReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.q.CreateTopic(context.Background(), req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, t)
}

// GET /api/v1/topics/:id/subtopics
func (h *TestHandler) ListSubtopics(c *gin.Context) {
	topicID, err := parseID(c, "id")
	if err != nil {
		return
	}
	subs, err := h.q.GetSubtopicsByTopic(context.Background(), topicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, subs)
}

// POST /api/v1/topics/:id/subtopics
type createSubtopicReq struct {
	Name string `json:"name" binding:"required"`
}

func (h *TestHandler) CreateSubtopic(c *gin.Context) {
	topicID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req createSubtopicReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s, err := h.q.CreateSubtopic(context.Background(), db.CreateSubtopicParams{TopicID: topicID, Name: req.Name})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, s)
}

// PUT /api/v1/questions/:id
type updateQuestionReq struct {
	Text        string  `json:"text" binding:"required"`
	OrderNum    int16   `json:"order_num"`
	Points      int16   `json:"points"`
	TopicID     *int32  `json:"topic_id"`
	SubtopicID  *int32  `json:"subtopic_id"`
	Explanation *string `json:"explanation"`
	Difficulty  int16   `json:"difficulty"`
}

func (h *TestHandler) UpdateQuestion(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req updateQuestionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Points == 0 {
		req.Points = 1
	}
	udiff := req.Difficulty
	if udiff < 1 || udiff > 3 {
		udiff = 1
	}
	params := db.UpdateQuestionParams{
		ID:         id,
		Text:       req.Text,
		OrderNum:   req.OrderNum,
		Points:     req.Points,
		Difficulty: udiff,
	}
	if req.TopicID != nil {
		params.TopicID = pgtype.Int4{Int32: *req.TopicID, Valid: true}
	}
	if req.SubtopicID != nil {
		params.SubtopicID = pgtype.Int4{Int32: *req.SubtopicID, Valid: true}
	}
	if req.Explanation != nil && *req.Explanation != "" {
		params.Explanation = pgtype.Text{String: *req.Explanation, Valid: true}
	}
	q, err := h.q.UpdateQuestion(context.Background(), params)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "question not found"})
		return
	}
	c.JSON(http.StatusOK, q)
}

// DELETE /api/v1/questions/:id
func (h *TestHandler) DeleteQuestion(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	_ = h.q.DeleteQuestion(context.Background(), id)
	c.Status(http.StatusNoContent)
}

// POST /api/v1/questions/:id/options
type createOptionReq struct {
	Text      string `json:"text" binding:"required"`
	IsCorrect bool   `json:"is_correct"`
	OrderNum  int16  `json:"order_num"`
}

func (h *TestHandler) CreateOption(c *gin.Context) {
	questionID, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req createOptionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	opt, err := h.q.CreateAnswerOption(context.Background(), db.CreateAnswerOptionParams{
		QuestionID: questionID,
		Text:       req.Text,
		IsCorrect:  req.IsCorrect,
		OrderNum:   req.OrderNum,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, opt)
}

// PUT /api/v1/options/:id
type updateOptionReq struct {
	Text      string `json:"text" binding:"required"`
	IsCorrect bool   `json:"is_correct"`
	OrderNum  int16  `json:"order_num"`
}

func (h *TestHandler) UpdateOption(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	var req updateOptionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	opt, err := h.q.UpdateAnswerOption(context.Background(), db.UpdateAnswerOptionParams{
		ID:        id,
		Text:      req.Text,
		IsCorrect: req.IsCorrect,
		OrderNum:  req.OrderNum,
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "option not found"})
		return
	}
	c.JSON(http.StatusOK, opt)
}

// DELETE /api/v1/options/:id
func (h *TestHandler) DeleteOption(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	_ = h.q.DeleteAnswerOption(context.Background(), id)
	c.Status(http.StatusNoContent)
}

// ═══════════════════════════════════════════════════════════════════════════
// ОБЩИЕ — список тестов
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/v1/groups/:id/tests
func (h *TestHandler) ListTests(c *gin.Context) {
	groupID, err := parseID(c, "id")
	if err != nil {
		return
	}
	tests, err := h.q.GetTestsByGroup(context.Background(), pgtype.Int4{Int32: groupID, Valid: true})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, tests)
}

// GET /api/v1/tests/mine — все тесты учителя
func (h *TestHandler) ListMyTests(c *gin.Context) {
	userID, _ := c.Get("user_id")
	tests, err := h.q.GetTestsByCreator(context.Background(), pgtype.Int4{Int32: userID.(int32), Valid: true})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, tests)
}

// GET /api/v1/tests/public
func (h *TestHandler) ListPublicTests(c *gin.Context) {
	tests, err := h.q.GetPublicTests(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, tests)
}

// GET /api/v1/tests/:id/results — результаты теста (учитель)
func (h *TestHandler) GetTestResults(c *gin.Context) {
	ctx := context.Background()
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	test, err := h.q.GetTestByID(ctx, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test not found"})
		return
	}

	// Если дедлайн прошёл и тест привязан к группе — выставить 0 тем, кто не сдал
	if test.GroupID.Valid && test.Deadline.Valid && time.Now().After(test.Deadline.Time) {
		// Посчитать максимальный балл из вопросов
		questions, _ := h.q.GetQuestionsByTest(ctx, id)
		var maxScore int16
		for _, q := range questions {
			maxScore += q.Points
		}
		// Найти студентов без попытки и создать нулевую
		missing, _ := h.q.GetStudentsWithoutAttempt(ctx, db.GetStudentsWithoutAttemptParams{
			GroupID: test.GroupID.Int32,
			TestID:  id,
		})
		for _, s := range missing {
			_, _ = h.q.CreateZeroAttempt(ctx, db.CreateZeroAttemptParams{
				TestID:   id,
				UserID:   s.ID,
				MaxScore: pgtype.Int2{Int16: maxScore, Valid: true},
			})
		}
	}

	rows, err := h.q.GetTestResults(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"test": test, "results": rows})
}

// GET /api/v1/tests/:id — тест с вопросами (для учителя — с is_correct)
func (h *TestHandler) GetTestFull(c *gin.Context) {
	id, err := parseID(c, "id")
	if err != nil {
		return
	}
	test, err := h.q.GetTestByID(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test not found"})
		return
	}

	questions, _ := h.q.GetQuestionsByTest(context.Background(), id)
	options, _ := h.q.GetOptionsByTest(context.Background(), id)

	// Сгруппировать варианты по question_id
	optMap := make(map[int32][]db.AnswerOption)
	for _, o := range options {
		optMap[o.QuestionID] = append(optMap[o.QuestionID], o)
	}

	type questionWithOptions struct {
		db.Question
		Options []db.AnswerOption `json:"options"`
	}
	qs := make([]questionWithOptions, len(questions))
	for i, q := range questions {
		qs[i] = questionWithOptions{Question: q, Options: optMap[q.ID]}
		if qs[i].Options == nil {
			qs[i].Options = []db.AnswerOption{}
		}
	}

	c.JSON(http.StatusOK, gin.H{"test": test, "questions": qs})
}

// ═══════════════════════════════════════════════════════════════════════════
// СТУДЕНТ — прохождение теста
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/v1/tests/:id/attempts — начать попытку
func (h *TestHandler) StartAttempt(c *gin.Context) {
	testID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")
	uid := userID.(int32)

	test, err := h.q.GetTestByID(context.Background(), testID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test not found"})
		return
	}
	if !test.IsPublished {
		c.JSON(http.StatusForbidden, gin.H{"error": "test is not published"})
		return
	}
	// Приватный тест с группой — проверить что студент состоит в группе
	if !test.IsPublic && test.GroupID.Valid {
		inGroup := false
		students, _ := h.q.GetStudentsByGroup(context.Background(), test.GroupID.Int32)
		for _, s := range students {
			if s.ID == uid {
				inGroup = true
				break
			}
		}
		if !inGroup {
			c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this group"})
			return
		}
	}

	// Проверить количество попыток
	count, _ := h.q.CountAttemptsByUserAndTest(context.Background(), db.CountAttemptsByUserAndTestParams{
		UserID: uid,
		TestID: testID,
	})
	if count >= int64(test.MaxAttempts) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no attempts remaining"})
		return
	}

	attempt, err := h.q.CreateAttempt(context.Background(), db.CreateAttemptParams{
		TestID: testID,
		UserID: uid,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Вернуть попытку + вопросы БЕЗ is_correct
	questions, _ := h.q.GetQuestionsByTest(context.Background(), testID)
	options, _ := h.q.GetOptionsByTest(context.Background(), testID)

	type optionView struct {
		ID       int32  `json:"id"`
		Text     string `json:"text"`
		OrderNum int16  `json:"order_num"`
	}
	type questionView struct {
		ID       int32        `json:"id"`
		Text     string       `json:"text"`
		OrderNum int16        `json:"order_num"`
		Points   int16        `json:"points"`
		Options  []optionView `json:"options"`
	}

	optMap := make(map[int32][]optionView)
	for _, o := range options {
		optMap[o.QuestionID] = append(optMap[o.QuestionID], optionView{
			ID:       o.ID,
			Text:     o.Text,
			OrderNum: o.OrderNum,
		})
	}

	qs := make([]questionView, len(questions))
	for i, q := range questions {
		qs[i] = questionView{
			ID:       q.ID,
			Text:     q.Text,
			OrderNum: q.OrderNum,
			Points:   q.Points,
			Options:  optMap[q.ID],
		}
		if qs[i].Options == nil {
			qs[i].Options = []optionView{}
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"attempt_id": attempt.ID,
		"test":       gin.H{"title": test.Title, "time_limit": test.TimeLimit},
		"questions":  qs,
	})
}

// POST /api/v1/attempts/:id/answer — сохранить ответ на вопрос
type submitAnswerReq struct {
	QuestionID int32 `json:"question_id" binding:"required"`
	OptionID   int32 `json:"option_id" binding:"required"`
}

func (h *TestHandler) SubmitAnswer(c *gin.Context) {
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetAttemptByID(context.Background(), attemptID)
	if err != nil || attempt.UserID != userID.(int32) {
		c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		return
	}
	if attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attempt already finished"})
		return
	}

	var req submitAnswerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	answer, err := h.q.UpsertStudentAnswer(context.Background(), db.UpsertStudentAnswerParams{
		AttemptID:  attemptID,
		QuestionID: req.QuestionID,
		OptionID:   pgtype.Int4{Int32: req.OptionID, Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, answer)
}

// POST /api/v1/attempts/:id/finish — завершить попытку и получить результат
func (h *TestHandler) FinishAttempt(c *gin.Context) {
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetAttemptByID(context.Background(), attemptID)
	if err != nil || attempt.UserID != userID.(int32) {
		c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		return
	}
	if attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attempt already finished"})
		return
	}

	questions, _ := h.q.GetQuestionsByTest(context.Background(), attempt.TestID)
	options, _ := h.q.GetOptionsByTest(context.Background(), attempt.TestID)
	studentAnswers, _ := h.q.GetAnswersByAttempt(context.Background(), attemptID)

	// Карты для быстрого доступа
	correctOption := make(map[int32]int32)  // question_id → correct option_id
	questionPoints := make(map[int32]int16) // question_id → points
	for _, o := range options {
		if o.IsCorrect {
			correctOption[o.QuestionID] = o.ID
		}
	}
	for _, q := range questions {
		questionPoints[q.ID] = q.Points
	}

	chosenOption := make(map[int32]int32) // question_id → chosen option_id
	for _, a := range studentAnswers {
		if a.OptionID.Valid {
			chosenOption[a.QuestionID] = a.OptionID.Int32
		}
	}

	// Считать очки
	var score, maxScore int16
	for _, q := range questions {
		maxScore += q.Points
		if chosenOption[q.ID] == correctOption[q.ID] {
			score += q.Points
		}
	}

	finished, err := h.q.FinishAttempt(context.Background(), db.FinishAttemptParams{
		ID:       attemptID,
		Score:    pgtype.Int2{Int16: score, Valid: true},
		MaxScore: pgtype.Int2{Int16: maxScore, Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Вернуть результат с правильными ответами
	type optionResult struct {
		ID        int32  `json:"id"`
		Text      string `json:"text"`
		IsCorrect bool   `json:"is_correct"`
		Chosen    bool   `json:"chosen"`
	}
	type questionResult struct {
		ID        int32          `json:"id"`
		Text      string         `json:"text"`
		Points    int16          `json:"points"`
		IsCorrect bool           `json:"is_correct"`
		Options   []optionResult `json:"options"`
	}

	optMap := make(map[int32][]db.AnswerOption)
	for _, o := range options {
		optMap[o.QuestionID] = append(optMap[o.QuestionID], o)
	}

	qResults := make([]questionResult, len(questions))
	for i, q := range questions {
		chosen := chosenOption[q.ID]
		correct := correctOption[q.ID]
		opts := make([]optionResult, len(optMap[q.ID]))
		for j, o := range optMap[q.ID] {
			opts[j] = optionResult{
				ID:        o.ID,
				Text:      o.Text,
				IsCorrect: o.IsCorrect,
				Chosen:    o.ID == chosen,
			}
		}
		qResults[i] = questionResult{
			ID:        q.ID,
			Text:      q.Text,
			Points:    q.Points,
			IsCorrect: chosen != 0 && chosen == correct,
			Options:   opts,
		}
	}

	test, _ := h.q.GetTestByID(context.Background(), attempt.TestID)
	canSee := h.canSeeResults(context.Background(), test)

	var deadlineStr *string
	if test.Deadline.Valid {
		s := test.Deadline.Time.Format(time.RFC3339)
		deadlineStr = &s
	}

	resp := gin.H{
		"attempt":          finished,
		"score":            score,
		"max_score":        maxScore,
		"percent":          func() int { if maxScore == 0 { return 0 }; return int(score) * 100 / int(maxScore) }(),
		"can_see_answers":  canSee,
		"deadline":         deadlineStr,
	}
	if canSee {
		resp["questions"] = qResults
	}
	c.JSON(http.StatusOK, resp)
}

// GET /api/v1/attempts/:id/review — подробный разбор (только если результаты открыты)
func (h *TestHandler) AttemptReview(c *gin.Context) {
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetAttemptByID(context.Background(), attemptID)
	if err != nil || attempt.UserID != userID.(int32) {
		c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		return
	}
	if !attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attempt not finished"})
		return
	}

	test, _ := h.q.GetTestByID(context.Background(), attempt.TestID)
	if !h.canSeeResults(context.Background(), test) {
		var deadlineStr *string
		if test.Deadline.Valid {
			s := test.Deadline.Time.Format(time.RFC3339)
			deadlineStr = &s
		}
		c.JSON(http.StatusForbidden, gin.H{
			"error":    "results not available yet",
			"deadline": deadlineStr,
		})
		return
	}

	questions, _ := h.q.GetQuestionsByTest(context.Background(), attempt.TestID)
	options, _ := h.q.GetOptionsByTest(context.Background(), attempt.TestID)
	studentAnswers, _ := h.q.GetAnswersByAttempt(context.Background(), attemptID)

	correctOption := make(map[int32]int32)
	for _, o := range options {
		if o.IsCorrect {
			correctOption[o.QuestionID] = o.ID
		}
	}
	chosenOption := make(map[int32]int32)
	for _, a := range studentAnswers {
		if a.OptionID.Valid {
			chosenOption[a.QuestionID] = a.OptionID.Int32
		}
	}

	optMap := make(map[int32][]db.AnswerOption)
	for _, o := range options {
		optMap[o.QuestionID] = append(optMap[o.QuestionID], o)
	}

	type optionResult struct {
		ID        int32  `json:"id"`
		Text      string `json:"text"`
		IsCorrect bool   `json:"is_correct"`
		Chosen    bool   `json:"chosen"`
	}
	type questionResult struct {
		ID        int32          `json:"id"`
		Text      string         `json:"text"`
		Points    int16          `json:"points"`
		IsCorrect bool           `json:"is_correct"`
		Options   []optionResult `json:"options"`
	}

	qResults := make([]questionResult, len(questions))
	for i, q := range questions {
		chosen := chosenOption[q.ID]
		correct := correctOption[q.ID]
		opts := make([]optionResult, len(optMap[q.ID]))
		for j, o := range optMap[q.ID] {
			opts[j] = optionResult{ID: o.ID, Text: o.Text, IsCorrect: o.IsCorrect, Chosen: o.ID == chosen}
		}
		qResults[i] = questionResult{
			ID: q.ID, Text: q.Text, Points: q.Points,
			IsCorrect: chosen != 0 && chosen == correct,
			Options:   opts,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"score":     attempt.Score,
		"max_score": attempt.MaxScore,
		"questions": qResults,
	})
}

// GET /api/v1/attempts/my — история попыток текущего пользователя
func (h *TestHandler) ListMyAttempts(c *gin.Context) {
	userID, _ := c.Get("user_id")
	rows, err := h.q.GetFinishedAttemptsByUser(context.Background(), userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, rows)
}

package handler

import (
	"context"
	"math/rand"
	"net/http"
	"time"

	"testing-app/config"
	db "testing-app/db/sqlc"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ENTHandler struct {
	q    db.Querier
	pool *pgxpool.Pool
}

func NewENTHandler(pool *pgxpool.Pool, _ *config.Config) *ENTHandler {
	return &ENTHandler{q: db.New(pool), pool: pool}
}

// ── Question bank random selectors ───────────────────────────────────────────

func (h *ENTHandler) selectByDifficulty(ctx context.Context, topicID int32, difficulty int16, n int) ([]db.Question, error) {
	rows, err := h.pool.Query(ctx, `
		SELECT id, test_id, text, order_num, points, created_at, owner_id,
		       topic_id, subtopic_id, explanation, difficulty
		FROM questions
		WHERE topic_id = $1 AND difficulty = $2 AND owner_id IS NOT NULL
		ORDER BY RANDOM() LIMIT $3`, topicID, difficulty, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanQuestions(rows)
}

func (h *ENTHandler) selectSingleAnswer(ctx context.Context, topicID int32, n int) ([]db.Question, error) {
	rows, err := h.pool.Query(ctx, `
		SELECT q.id, q.test_id, q.text, q.order_num, q.points, q.created_at, q.owner_id,
		       q.topic_id, q.subtopic_id, q.explanation, q.difficulty
		FROM questions q
		WHERE q.topic_id = $1 AND q.owner_id IS NOT NULL
		  AND (SELECT COUNT(*) FROM answer_options ao WHERE ao.question_id = q.id AND ao.is_correct) = 1
		ORDER BY RANDOM() LIMIT $2`, topicID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanQuestions(rows)
}

func (h *ENTHandler) selectMultiAnswer(ctx context.Context, topicID int32, n int) ([]db.Question, error) {
	rows, err := h.pool.Query(ctx, `
		SELECT q.id, q.test_id, q.text, q.order_num, q.points, q.created_at, q.owner_id,
		       q.topic_id, q.subtopic_id, q.explanation, q.difficulty
		FROM questions q
		WHERE q.topic_id = $1 AND q.owner_id IS NOT NULL
		  AND (SELECT COUNT(*) FROM answer_options ao WHERE ao.question_id = q.id AND ao.is_correct) >= 2
		ORDER BY RANDOM() LIMIT $2`, topicID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanQuestions(rows)
}

// ── Option fetcher ────────────────────────────────────────────────────────────

type rawOption struct {
	ID         int32  `json:"id"`
	QuestionID int32  `json:"question_id"`
	Text       string `json:"text"`
	IsCorrect  bool   `json:"is_correct"`
	OrderNum   int16  `json:"order_num"`
}

func (h *ENTHandler) fetchOptions(ctx context.Context, questionIDs []int32) (map[int32][]rawOption, error) {
	if len(questionIDs) == 0 {
		return map[int32][]rawOption{}, nil
	}
	rows, err := h.pool.Query(ctx,
		`SELECT id, question_id, text, is_correct, order_num
		 FROM answer_options WHERE question_id = ANY($1)
		 ORDER BY question_id, order_num, id`, questionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := map[int32][]rawOption{}
	for rows.Next() {
		var o rawOption
		if err := rows.Scan(&o.ID, &o.QuestionID, &o.Text, &o.IsCorrect, &o.OrderNum); err != nil {
			return nil, err
		}
		m[o.QuestionID] = append(m[o.QuestionID], o)
	}
	return m, rows.Err()
}

// ── Scanner helper ────────────────────────────────────────────────────────────

func scanQuestions(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]db.Question, error) {
	var result []db.Question
	for rows.Next() {
		var q db.Question
		if err := rows.Scan(&q.ID, &q.TestID, &q.Text, &q.OrderNum, &q.Points,
			&q.CreatedAt, &q.OwnerID, &q.TopicID, &q.SubtopicID, &q.Explanation, &q.Difficulty); err != nil {
			return nil, err
		}
		result = append(result, q)
	}
	return result, rows.Err()
}

// ── Response types ────────────────────────────────────────────────────────────

type entOptionResp struct {
	ID       int32  `json:"id"`
	Text     string `json:"text"`
	OrderNum int16  `json:"order_num"`
}

type entOptionResult struct {
	ID        int32  `json:"id"`
	Text      string `json:"text"`
	OrderNum  int16  `json:"order_num"`
	IsCorrect bool   `json:"is_correct"`
}

type entQuestionResp struct {
	ID       int32           `json:"id"`
	Text     string          `json:"text"`
	IsMulti  bool            `json:"is_multi"`
	OrderNum int16           `json:"order_num"`
	Options  []entOptionResp `json:"options"`
}

type entQuestionResult struct {
	ID        int32             `json:"id"`
	Text      string            `json:"text"`
	IsMulti   bool              `json:"is_multi"`
	IsCorrect bool              `json:"is_correct"`
	OrderNum  int16             `json:"order_num"`
	Options   []entOptionResult `json:"options"`
	Selected  []int32           `json:"selected"`
}

type entSectionResp struct {
	Slot      int16             `json:"slot"`
	TopicID   int32             `json:"topic_id"`
	TopicName string            `json:"topic_name"`
	MaxScore  int16             `json:"max_score"`
	Questions []entQuestionResp `json:"questions"`
}

type entSectionResult struct {
	Slot      int16               `json:"slot"`
	TopicID   int32               `json:"topic_id"`
	TopicName string              `json:"topic_name"`
	Score     int16               `json:"score"`
	MaxScore  int16               `json:"max_score"`
	Questions []entQuestionResult `json:"questions"`
}

// ── Scoring ───────────────────────────────────────────────────────────────────

// scoreQuestion returns (correct, points). Multi-answer = 2 pts, single = 1 pt.
func scoreQuestion(correctOpts, selectedOpts []int32) (bool, int16) {
	if len(correctOpts) == 0 {
		return false, 0
	}
	cs := make(map[int32]bool, len(correctOpts))
	for _, id := range correctOpts {
		cs[id] = true
	}
	ss := make(map[int32]bool, len(selectedOpts))
	for _, id := range selectedOpts {
		ss[id] = true
	}
	if len(ss) != len(cs) {
		return false, 0
	}
	for id := range ss {
		if !cs[id] {
			return false, 0
		}
	}
	if len(correctOpts) >= 2 {
		return true, 2
	}
	return true, 1
}

// maxScoreForSlot returns theoretical max score for a slot's questions.
func maxScoreForSlot(qs []db.Question, optMap map[int32][]rawOption) int16 {
	var total int16
	for _, q := range qs {
		var correct int16
		for _, o := range optMap[q.ID] {
			if o.IsCorrect {
				correct++
			}
		}
		if correct >= 2 {
			total += 2
		} else {
			total += 1
		}
	}
	return total
}

// ── POST /ent/start ───────────────────────────────────────────────────────────

// ENT quota per slot
type slotCfg struct {
	easy, medium, hard int // for fixed subjects
	single, multi      int // for profile subjects
}

var (
	slotCfgMG  = slotCfg{easy: 3, medium: 3, hard: 4}   // Мат. грамотность
	slotCfgHK  = slotCfg{easy: 6, medium: 7, hard: 7}   // История Казахстана
	slotCfgPrf = slotCfg{single: 30, multi: 10}           // Profile subjects
)

func (h *ENTHandler) Start(c *gin.Context) {
	ctx := context.Background()
	userID, _ := c.Get("user_id")

	// Get user to read profile subjects
	user, err := h.q.GetUserByID(ctx, userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if !user.ProfileSubject1.Valid || !user.ProfileSubject2.Valid {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Сначала выберите два профильных предмета в профиле",
		})
		return
	}

	// Fixed topic IDs by name
	topicMG, err := h.q.GetTopicByName(ctx, "Математическая грамотность")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "topic Мат. грамотность not found"})
		return
	}
	topicHK, err := h.q.GetTopicByName(ctx, "История Казахстана")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "topic История Казахстана not found"})
		return
	}

	// Select questions per slot
	var slot1, slot2, slot3, slot4 []db.Question

	for _, pair := range []struct {
		d int16
		n int
	}{{1, slotCfgMG.easy}, {2, slotCfgMG.medium}, {3, slotCfgMG.hard}} {
		qs, err := h.selectByDifficulty(ctx, topicMG.ID, pair.d, pair.n)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to select questions"})
			return
		}
		slot1 = append(slot1, qs...)
	}

	for _, pair := range []struct {
		d int16
		n int
	}{{1, slotCfgHK.easy}, {2, slotCfgHK.medium}, {3, slotCfgHK.hard}} {
		qs, err := h.selectByDifficulty(ctx, topicHK.ID, pair.d, pair.n)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to select questions"})
			return
		}
		slot2 = append(slot2, qs...)
	}

	for _, call := range []struct {
		topicID int32
		target  *[]db.Question
	}{
		{user.ProfileSubject1.Int32, &slot3},
		{user.ProfileSubject2.Int32, &slot4},
	} {
		singles, err := h.selectSingleAnswer(ctx, call.topicID, slotCfgPrf.single)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to select questions"})
			return
		}
		multis, err := h.selectMultiAnswer(ctx, call.topicID, slotCfgPrf.multi)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to select questions"})
			return
		}
		*call.target = append(singles, multis...)
		// Shuffle combined list
		src := rand.New(rand.NewSource(time.Now().UnixNano()))
		src.Shuffle(len(*call.target), func(i, j int) {
			(*call.target)[i], (*call.target)[j] = (*call.target)[j], (*call.target)[i]
		})
	}

	// Create attempt
	attempt, err := h.q.CreateENTAttempt(ctx, db.CreateENTAttemptParams{
		UserID:     userID.(int32),
		Subject3ID: pgtype.Int4{Int32: user.ProfileSubject1.Int32, Valid: true},
		Subject4ID: pgtype.Int4{Int32: user.ProfileSubject2.Int32, Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create attempt"})
		return
	}

	// Insert questions for each slot
	allBySlot := []struct {
		slot int16
		qs   []db.Question
	}{{1, slot1}, {2, slot2}, {3, slot3}, {4, slot4}}

	var allQIDs []int32
	for _, s := range allBySlot {
		for i, q := range s.qs {
			if err := h.q.InsertENTQuestion(ctx, db.InsertENTQuestionParams{
				AttemptID:  attempt.ID,
				QuestionID: q.ID,
				Slot:       s.slot,
				OrderNum:   int16(i + 1),
			}); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save questions"})
				return
			}
			allQIDs = append(allQIDs, q.ID)
		}
	}

	// Fetch options for all questions at once (strip is_correct for ongoing quiz)
	optMap, err := h.fetchOptions(ctx, allQIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch options"})
		return
	}

	// Build topic names map
	topicNames := map[int32]string{}
	if allTopics, err := h.q.GetTopics(ctx); err == nil {
		for _, t := range allTopics {
			topicNames[t.ID] = t.Name
		}
	}

	slotTopics := []int32{topicMG.ID, topicHK.ID, user.ProfileSubject1.Int32, user.ProfileSubject2.Int32}

	sections := make([]entSectionResp, 0, 4)
	for i, s := range allBySlot {
		topicID := slotTopics[i]
		section := entSectionResp{
			Slot:      s.slot,
			TopicID:   topicID,
			TopicName: topicNames[topicID],
			MaxScore:  maxScoreForSlot(s.qs, optMap),
			Questions: make([]entQuestionResp, 0, len(s.qs)),
		}
		for idx, q := range s.qs {
			opts := optMap[q.ID]
			var correctCount int
			for _, o := range opts {
				if o.IsCorrect {
					correctCount++
				}
			}
			qr := entQuestionResp{
				ID:       q.ID,
				Text:     q.Text,
				IsMulti:  correctCount >= 2,
				OrderNum: int16(idx + 1),
				Options:  make([]entOptionResp, 0, len(opts)),
			}
			for _, o := range opts {
				qr.Options = append(qr.Options, entOptionResp{ID: o.ID, Text: o.Text, OrderNum: o.OrderNum})
			}
			section.Questions = append(section.Questions, qr)
		}
		sections = append(sections, section)
	}

	c.JSON(http.StatusCreated, gin.H{
		"attempt":  attempt,
		"sections": sections,
		"answers":  map[string][]int32{},
	})
}

// ── GET /ent/attempts/:id ─────────────────────────────────────────────────────

func (h *ENTHandler) GetAttempt(c *gin.Context) {
	ctx := context.Background()
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetENTAttemptByID(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if attempt.UserID != userID.(int32) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	aqRows, err := h.q.GetENTAttemptQuestions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Collect question IDs per slot
	slotQMap := map[int16][]db.EntAttemptQuestion{}
	var allQIDs []int32
	for _, aq := range aqRows {
		slotQMap[aq.Slot] = append(slotQMap[aq.Slot], aq)
		allQIDs = append(allQIDs, aq.QuestionID)
	}

	// Fetch question texts
	qTextMap := map[int32]db.Question{}
	if len(allQIDs) > 0 {
		rows, err := h.pool.Query(ctx,
			`SELECT id, test_id, text, order_num, points, created_at, owner_id, topic_id, subtopic_id, explanation, difficulty
			 FROM questions WHERE id = ANY($1)`, allQIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		defer rows.Close()
		qs, err := scanQuestions(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		for _, q := range qs {
			qTextMap[q.ID] = q
		}
	}

	// Fetch options (strip is_correct)
	optMap, err := h.fetchOptions(ctx, allQIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Fetch current answers
	selOpts, err := h.q.GetENTSelectedOptions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	answersMap := map[int32][]int32{}
	for _, so := range selOpts {
		answersMap[so.QuestionID] = append(answersMap[so.QuestionID], so.OptionID)
	}

	// Fetch topic names
	topicsAll, _ := h.q.GetTopics(ctx)
	topicNames := map[int32]string{}
	for _, t := range topicsAll {
		topicNames[t.ID] = t.Name
	}

	slotTopics := []int32{0, 0, 0, 0} // indices 0-3 for slots 1-4
	// Resolve fixed topics
	if t, err := h.q.GetTopicByName(ctx, "Математическая грамотность"); err == nil {
		slotTopics[0] = t.ID
	}
	if t, err := h.q.GetTopicByName(ctx, "История Казахстана"); err == nil {
		slotTopics[1] = t.ID
	}
	slotTopics[2] = attempt.Subject3ID.Int32
	slotTopics[3] = attempt.Subject4ID.Int32

	sections := make([]entSectionResp, 0, 4)
	for slotNum := int16(1); slotNum <= 4; slotNum++ {
		aqs := slotQMap[slotNum]
		topicID := slotTopics[slotNum-1]
		section := entSectionResp{
			Slot:      slotNum,
			TopicID:   topicID,
			TopicName: topicNames[topicID],
			Questions: make([]entQuestionResp, 0, len(aqs)),
		}
		var maxS int16
		for _, aq := range aqs {
			q := qTextMap[aq.QuestionID]
			opts := optMap[q.ID]
			var correctCount int
			for _, o := range opts {
				if o.IsCorrect {
					correctCount++
				}
			}
			if correctCount >= 2 {
				maxS += 2
			} else {
				maxS += 1
			}
			qr := entQuestionResp{
				ID:       q.ID,
				Text:     q.Text,
				IsMulti:  correctCount >= 2,
				OrderNum: aq.OrderNum,
				Options:  make([]entOptionResp, 0, len(opts)),
			}
			for _, o := range opts {
				qr.Options = append(qr.Options, entOptionResp{ID: o.ID, Text: o.Text, OrderNum: o.OrderNum})
			}
			section.Questions = append(section.Questions, qr)
		}
		section.MaxScore = maxS
		sections = append(sections, section)
	}

	c.JSON(http.StatusOK, gin.H{
		"attempt":  attempt,
		"sections": sections,
		"answers":  answersMap,
	})
}

// ── POST /ent/attempts/:id/answer ─────────────────────────────────────────────

type entAnswerReq struct {
	QuestionID int32   `json:"question_id" binding:"required"`
	OptionIDs  []int32 `json:"option_ids"`
}

func (h *ENTHandler) SaveAnswer(c *gin.Context) {
	ctx := context.Background()
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetENTAttemptByID(ctx, attemptID)
	if err != nil || attempt.UserID != userID.(int32) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attempt already finished"})
		return
	}

	var req entAnswerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Replace existing selection
	if err := h.q.ClearENTAnswersForQuestion(ctx, db.ClearENTAnswersForQuestionParams{
		AttemptID:  attemptID,
		QuestionID: req.QuestionID,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	for _, optID := range req.OptionIDs {
		if err := h.q.InsertENTSelectedOption(ctx, db.InsertENTSelectedOptionParams{
			AttemptID:  attemptID,
			QuestionID: req.QuestionID,
			OptionID:   optID,
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// ── POST /ent/attempts/:id/finish ─────────────────────────────────────────────

func (h *ENTHandler) Finish(c *gin.Context) {
	ctx := context.Background()
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetENTAttemptByID(ctx, attemptID)
	if err != nil || attempt.UserID != userID.(int32) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "already finished"})
		return
	}

	aqRows, err := h.q.GetENTAttemptQuestions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	var allQIDs []int32
	for _, aq := range aqRows {
		allQIDs = append(allQIDs, aq.QuestionID)
	}

	// Fetch options (with is_correct) and selected answers
	optMap, err := h.fetchOptions(ctx, allQIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	selOpts, err := h.q.GetENTSelectedOptions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	selectedMap := map[int32][]int32{}
	for _, so := range selOpts {
		selectedMap[so.QuestionID] = append(selectedMap[so.QuestionID], so.OptionID)
	}

	// Score per slot
	scores := [4]int16{}
	for _, aq := range aqRows {
		opts := optMap[aq.QuestionID]
		var correctIDs []int32
		for _, o := range opts {
			if o.IsCorrect {
				correctIDs = append(correctIDs, o.ID)
			}
		}
		_, pts := scoreQuestion(correctIDs, selectedMap[aq.QuestionID])
		scores[aq.Slot-1] += pts
	}

	finished, err := h.q.FinishENTAttempt(ctx, db.FinishENTAttemptParams{
		ID:     attemptID,
		Score1: pgtype.Int2{Int16: scores[0], Valid: true},
		Score2: pgtype.Int2{Int16: scores[1], Valid: true},
		Score3: pgtype.Int2{Int16: scores[2], Valid: true},
		Score4: pgtype.Int2{Int16: scores[3], Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, finished)
}

// ── GET /ent/attempts/:id/result ──────────────────────────────────────────────

func (h *ENTHandler) GetResult(c *gin.Context) {
	ctx := context.Background()
	attemptID, err := parseID(c, "id")
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")

	attempt, err := h.q.GetENTAttemptByID(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if attempt.UserID != userID.(int32) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if !attempt.FinishedAt.Valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attempt not finished yet"})
		return
	}

	aqRows, err := h.q.GetENTAttemptQuestions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	slotQMap := map[int16][]db.EntAttemptQuestion{}
	var allQIDs []int32
	for _, aq := range aqRows {
		slotQMap[aq.Slot] = append(slotQMap[aq.Slot], aq)
		allQIDs = append(allQIDs, aq.QuestionID)
	}

	qTextMap := map[int32]db.Question{}
	if len(allQIDs) > 0 {
		rows, err := h.pool.Query(ctx,
			`SELECT id, test_id, text, order_num, points, created_at, owner_id, topic_id, subtopic_id, explanation, difficulty
			 FROM questions WHERE id = ANY($1)`, allQIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		defer rows.Close()
		qs, _ := scanQuestions(rows)
		for _, q := range qs {
			qTextMap[q.ID] = q
		}
	}

	optMap, err := h.fetchOptions(ctx, allQIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	selOpts, err := h.q.GetENTSelectedOptions(ctx, attemptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	selectedMap := map[int32][]int32{}
	for _, so := range selOpts {
		selectedMap[so.QuestionID] = append(selectedMap[so.QuestionID], so.OptionID)
	}

	topicsAll, _ := h.q.GetTopics(ctx)
	topicNames := map[int32]string{}
	for _, t := range topicsAll {
		topicNames[t.ID] = t.Name
	}

	slotTopicIDs := [4]int32{0, 0, attempt.Subject3ID.Int32, attempt.Subject4ID.Int32}
	if t, err := h.q.GetTopicByName(ctx, "Математическая грамотность"); err == nil {
		slotTopicIDs[0] = t.ID
	}
	if t, err := h.q.GetTopicByName(ctx, "История Казахстана"); err == nil {
		slotTopicIDs[1] = t.ID
	}

	slotScores := [4]int16{
		attempt.Score1.Int16, attempt.Score2.Int16,
		attempt.Score3.Int16, attempt.Score4.Int16,
	}

	sections := make([]entSectionResult, 0, 4)
	var totalScore, totalMax int16

	for slotNum := int16(1); slotNum <= 4; slotNum++ {
		aqs := slotQMap[slotNum]
		topicID := slotTopicIDs[slotNum-1]
		section := entSectionResult{
			Slot:      slotNum,
			TopicID:   topicID,
			TopicName: topicNames[topicID],
			Score:     slotScores[slotNum-1],
			Questions: make([]entQuestionResult, 0, len(aqs)),
		}
		var maxS int16
		for _, aq := range aqs {
			q := qTextMap[aq.QuestionID]
			opts := optMap[q.ID]
			var correctIDs []int32
			for _, o := range opts {
				if o.IsCorrect {
					correctIDs = append(correctIDs, o.ID)
				}
			}
			if len(correctIDs) >= 2 {
				maxS += 2
			} else {
				maxS += 1
			}
			correct, _ := scoreQuestion(correctIDs, selectedMap[q.ID])
			qr := entQuestionResult{
				ID:        q.ID,
				Text:      q.Text,
				IsMulti:   len(correctIDs) >= 2,
				IsCorrect: correct,
				OrderNum:  aq.OrderNum,
				Selected:  selectedMap[q.ID],
				Options:   make([]entOptionResult, 0, len(opts)),
			}
			if qr.Selected == nil {
				qr.Selected = []int32{}
			}
			for _, o := range opts {
				qr.Options = append(qr.Options, entOptionResult{
					ID:        o.ID,
					Text:      o.Text,
					OrderNum:  o.OrderNum,
					IsCorrect: o.IsCorrect,
				})
			}
			section.Questions = append(section.Questions, qr)
		}
		section.MaxScore = maxS
		totalScore += section.Score
		totalMax += maxS
		sections = append(sections, section)
	}

	c.JSON(http.StatusOK, gin.H{
		"attempt":     attempt,
		"sections":    sections,
		"total_score": totalScore,
		"total_max":   totalMax,
	})
}

// ── GET /ent/attempts/my ──────────────────────────────────────────────────────

func (h *ENTHandler) ListMine(c *gin.Context) {
	ctx := context.Background()
	userID, _ := c.Get("user_id")
	attempts, err := h.q.GetMyENTAttempts(ctx, userID.(int32))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	topicsAll, _ := h.q.GetTopics(ctx)
	topicNames := map[int32]string{}
	for _, t := range topicsAll {
		topicNames[t.ID] = t.Name
	}

	type attemptItem struct {
		db.EntAttempt
		Subject3Name string `json:"subject3_name"`
		Subject4Name string `json:"subject4_name"`
		TotalScore   int16  `json:"total_score"`
		TotalMax     int16  `json:"total_max"`
	}

	result := make([]attemptItem, 0, len(attempts))
	for _, a := range attempts {
		item := attemptItem{EntAttempt: a}
		item.Subject3Name = topicNames[a.Subject3ID.Int32]
		item.Subject4Name = topicNames[a.Subject4ID.Int32]
		if a.FinishedAt.Valid {
			item.TotalScore = a.Score1.Int16 + a.Score2.Int16 + a.Score3.Int16 + a.Score4.Int16
			item.TotalMax = 10 + 20 + 50 + 50
		}
		result = append(result, item)
	}
	c.JSON(http.StatusOK, result)
}

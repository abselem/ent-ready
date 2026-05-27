-- ── tests ──────────────────────────────────────────────────────────────────

-- name: CreateTest :one
INSERT INTO tests (group_id, title, description, time_limit, max_attempts, is_public, created_by, deadline, topic_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetTestsByCreator :many
SELECT * FROM tests WHERE created_by = $1 ORDER BY created_at DESC;

-- name: GetTestByID :one
SELECT * FROM tests WHERE id = $1;

-- name: GetTestsByGroup :many
SELECT * FROM tests WHERE group_id = $1 ORDER BY created_at DESC;

-- name: GetPublicTests :many
SELECT * FROM tests WHERE is_published = TRUE AND is_public = TRUE ORDER BY created_at DESC;

-- name: UpdateTest :one
UPDATE tests SET title=$2, description=$3, time_limit=$4, max_attempts=$5, is_public=$6, deadline=$7, topic_id=$8
WHERE id=$1 RETURNING *;

-- name: PublishTest :exec
UPDATE tests SET is_published=TRUE WHERE id=$1;

-- name: DeleteTest :exec
DELETE FROM tests WHERE id=$1;

-- ── topics ─────────────────────────────────────────────────────────────────

-- name: GetTopics :many
SELECT * FROM topics ORDER BY name;

-- name: GetTopicByName :one
SELECT * FROM topics WHERE name = $1;

-- name: CreateTopic :one
INSERT INTO topics (name) VALUES ($1)
ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: GetSubtopicsByTopic :many
SELECT * FROM subtopics WHERE topic_id = $1 ORDER BY name;

-- name: CreateSubtopic :one
INSERT INTO subtopics (topic_id, name) VALUES ($1, $2)
ON CONFLICT (topic_id, name) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- ── questions (bank) ───────────────────────────────────────────────────────

-- name: CreateQuestion :one
INSERT INTO questions (text, order_num, points, owner_id, topic_id, subtopic_id, explanation, difficulty)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetQuestionsByTest :many
SELECT q.* FROM questions q
JOIN test_questions tq ON tq.question_id = q.id
WHERE tq.test_id = $1
ORDER BY tq.order_num, q.id;

-- name: GetMyQuestions :many
SELECT q.*, t.name AS topic_name, s.name AS subtopic_name
FROM questions q
LEFT JOIN topics t ON t.id = q.topic_id
LEFT JOIN subtopics s ON s.id = q.subtopic_id
WHERE q.owner_id = $1
ORDER BY q.created_at DESC;

-- name: GetMyQuestionsByTopic :many
SELECT q.*, t.name AS topic_name, s.name AS subtopic_name
FROM questions q
LEFT JOIN topics t ON t.id = q.topic_id
LEFT JOIN subtopics s ON s.id = q.subtopic_id
WHERE q.owner_id = $1 AND q.topic_id = $2
ORDER BY q.created_at DESC;

-- name: UpdateQuestion :one
UPDATE questions SET text=$2, order_num=$3, points=$4, topic_id=$5, subtopic_id=$6, explanation=$7, difficulty=$8
WHERE id=$1 RETURNING *;

-- name: DeleteQuestion :exec
DELETE FROM questions WHERE id=$1;

-- name: AddQuestionToTest :exec
INSERT INTO test_questions (test_id, question_id, order_num)
VALUES ($1, $2, $3)
ON CONFLICT (test_id, question_id) DO NOTHING;

-- name: RemoveQuestionFromTest :exec
DELETE FROM test_questions WHERE test_id=$1 AND question_id=$2;

-- name: CountQuestionsInTest :one
SELECT COUNT(*) FROM test_questions WHERE test_id=$1;

-- ── answer_options ─────────────────────────────────────────────────────────

-- name: CreateAnswerOption :one
INSERT INTO answer_options (question_id, text, is_correct, order_num)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOptionsByQuestion :many
SELECT * FROM answer_options WHERE question_id=$1 ORDER BY order_num, id;

-- name: GetOptionsByTest :many
SELECT ao.* FROM answer_options ao
JOIN test_questions tq ON tq.question_id = ao.question_id
WHERE tq.test_id = $1
ORDER BY ao.question_id, ao.order_num, ao.id;

-- name: UpdateAnswerOption :one
UPDATE answer_options SET text=$2, is_correct=$3, order_num=$4
WHERE id=$1 RETURNING *;

-- name: DeleteAnswerOption :exec
DELETE FROM answer_options WHERE id=$1;

-- ── attempts ───────────────────────────────────────────────────────────────

-- name: CreateAttempt :one
INSERT INTO test_attempts (test_id, user_id)
VALUES ($1, $2)
RETURNING *;

-- name: GetAttemptByID :one
SELECT * FROM test_attempts WHERE id=$1;

-- name: CountAttemptsByUserAndTest :one
SELECT COUNT(*) FROM test_attempts WHERE user_id=$1 AND test_id=$2;

-- name: FinishAttempt :one
UPDATE test_attempts SET finished_at=NOW(), score=$2, max_score=$3
WHERE id=$1 RETURNING *;

-- name: GetTestResults :many
SELECT u.id AS user_id, u.first_name, u.last_name,
       ta.id AS attempt_id, ta.score, ta.max_score, ta.finished_at
FROM test_attempts ta
JOIN users u ON u.id = ta.user_id
WHERE ta.test_id = $1 AND ta.finished_at IS NOT NULL
ORDER BY ta.score DESC, ta.finished_at ASC;

-- ── student_answers ────────────────────────────────────────────────────────

-- name: UpsertStudentAnswer :one
INSERT INTO student_answers (attempt_id, question_id, option_id)
VALUES ($1, $2, $3)
ON CONFLICT (attempt_id, question_id) DO UPDATE SET option_id = EXCLUDED.option_id
RETURNING *;

-- name: GetAnswersByAttempt :many
SELECT * FROM student_answers WHERE attempt_id=$1;

-- name: CountGroupStudents :one
SELECT COUNT(*) FROM user_groups WHERE group_id = $1;

-- name: CountFinishedAttempts :one
SELECT COUNT(DISTINCT user_id) FROM test_attempts WHERE test_id = $1 AND finished_at IS NOT NULL;

-- name: CreateZeroAttempt :one
INSERT INTO test_attempts (test_id, user_id, started_at, finished_at, score, max_score)
VALUES ($1, $2, NOW(), NOW(), 0, $3)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: GetStudentsWithoutAttempt :many
SELECT u.id, u.first_name, u.last_name FROM users u
JOIN user_groups ug ON ug.user_id = u.id
WHERE ug.group_id = $1
  AND u.id NOT IN (
    SELECT DISTINCT user_id FROM test_attempts WHERE test_id = $2 AND finished_at IS NOT NULL
  );

-- name: GetFinishedAttemptsByUser :many
SELECT ta.id, ta.test_id, t.title AS test_title,
       ta.score, ta.max_score, ta.started_at, ta.finished_at,
       t.topic_id, tp.name AS topic_name
FROM test_attempts ta
JOIN tests t ON t.id = ta.test_id
LEFT JOIN topics tp ON tp.id = t.topic_id
WHERE ta.user_id = $1 AND ta.finished_at IS NOT NULL
ORDER BY ta.finished_at DESC;

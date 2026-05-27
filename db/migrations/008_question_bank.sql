-- ── topics / subtopics ────────────────────────────────────────────────────────

CREATE TABLE topics (
    id   SERIAL PRIMARY KEY,
    name TEXT   NOT NULL UNIQUE
);

CREATE TABLE subtopics (
    id       SERIAL PRIMARY KEY,
    topic_id INT  NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    UNIQUE(topic_id, name)
);

-- ── extend questions ──────────────────────────────────────────────────────────

ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS owner_id    INT  REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS topic_id    INT  REFERENCES topics(id),
    ADD COLUMN IF NOT EXISTS subtopic_id INT  REFERENCES subtopics(id),
    ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Set owner from the test's creator for existing questions
UPDATE questions q
SET    owner_id = t.created_by
FROM   tests t
WHERE  q.test_id = t.id
  AND  q.owner_id IS NULL
  AND  t.created_by IS NOT NULL;

-- ── test_questions junction ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS test_questions (
    test_id     INT      NOT NULL REFERENCES tests(id)     ON DELETE CASCADE,
    question_id INT      NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    order_num   SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (test_id, question_id)
);

-- Migrate existing associations
INSERT INTO test_questions (test_id, question_id, order_num)
SELECT test_id, id, order_num
FROM   questions
WHERE  test_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Make test_id optional (questions can live in the bank without a test)
ALTER TABLE questions ALTER COLUMN test_id DROP NOT NULL;

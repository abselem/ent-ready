-- ============================================================
-- 003_tests.sql
-- ============================================================

CREATE TABLE tests (
    id           SERIAL       PRIMARY KEY,
    group_id     INT          NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    time_limit   SMALLINT,                          -- минуты, NULL = без лимита
    max_attempts SMALLINT     NOT NULL DEFAULT 1,
    is_published BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tests_group ON tests(group_id);

CREATE TABLE questions (
    id        SERIAL      PRIMARY KEY,
    test_id   INT         NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    text      TEXT        NOT NULL,
    order_num SMALLINT    NOT NULL DEFAULT 0,
    points    SMALLINT    NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_test ON questions(test_id);

CREATE TABLE answer_options (
    id          SERIAL   PRIMARY KEY,
    question_id INT      NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    text        TEXT     NOT NULL,
    is_correct  BOOLEAN  NOT NULL DEFAULT FALSE,
    order_num   SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_options_question ON answer_options(question_id);

CREATE TABLE test_attempts (
    id          SERIAL      PRIMARY KEY,
    test_id     INT         NOT NULL REFERENCES tests(id),
    user_id     INT         NOT NULL REFERENCES users(id),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    score       SMALLINT,
    max_score   SMALLINT
);

CREATE INDEX idx_attempts_user_test ON test_attempts(user_id, test_id);

CREATE TABLE student_answers (
    id          SERIAL PRIMARY KEY,
    attempt_id  INT    NOT NULL REFERENCES test_attempts(id),
    question_id INT    NOT NULL REFERENCES questions(id),
    option_id   INT    REFERENCES answer_options(id),
    UNIQUE(attempt_id, question_id)
);

CREATE TRIGGER trg_tests_updated_at
    BEFORE UPDATE ON tests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

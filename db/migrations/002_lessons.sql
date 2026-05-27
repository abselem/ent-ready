-- ============================================================
-- 002_lessons.sql
-- ============================================================

CREATE TABLE lessons (
    id           SERIAL       PRIMARY KEY,
    group_id     INT          NOT NULL REFERENCES groups(id),
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    scheduled_at TIMESTAMPTZ  NOT NULL,
    duration_min SMALLINT     NOT NULL DEFAULT 45,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lessons_group_time ON lessons(group_id, scheduled_at);

CREATE TRIGGER trg_lessons_updated_at
    BEFORE UPDATE ON lessons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

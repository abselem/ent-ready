-- Make group_id and scheduled_at optional
ALTER TABLE lessons ALTER COLUMN group_id    DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN scheduled_at DROP NOT NULL;

-- Publication and visibility
ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS visibility   TEXT    NOT NULL DEFAULT 'private',
    ADD COLUMN IF NOT EXISTS view_count   INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by   INT     REFERENCES users(id);

-- Backfill created_by from group teacher
UPDATE lessons l
SET    created_by = g.teacher_id
FROM   groups g
WHERE  g.id = l.group_id AND l.created_by IS NULL;

-- Unique view tracking (one row per user per lesson)
CREATE TABLE IF NOT EXISTS lesson_views (
    lesson_id INT         NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    user_id   INT         NOT NULL REFERENCES users(id),
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lesson_id, user_id)
);

-- Fine-grained access: for visibility='private'
CREATE TABLE IF NOT EXISTS lesson_access (
    lesson_id INT  NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    type      TEXT NOT NULL CHECK (type IN ('group', 'student')),
    ref_id    INT  NOT NULL,
    PRIMARY KEY (lesson_id, type, ref_id)
);

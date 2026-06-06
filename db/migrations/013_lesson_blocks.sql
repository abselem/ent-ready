-- Rich lesson content blocks (text, code, image, note)
CREATE TABLE lesson_blocks (
    id         SERIAL       PRIMARY KEY,
    lesson_id  INT          NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    type       TEXT         NOT NULL DEFAULT 'text',  -- text | code | image | note
    content    TEXT         NOT NULL DEFAULT '',
    language   TEXT,                                   -- code language label (go, python…)
    caption    TEXT,                                   -- image caption
    order_num  SMALLINT     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX lesson_blocks_lesson_id_idx ON lesson_blocks (lesson_id, order_num);

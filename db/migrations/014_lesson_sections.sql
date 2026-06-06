-- Add section grouping and ordering to lessons
ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS section_title TEXT,      -- e.g. "Базовые понятия"
    ADD COLUMN IF NOT EXISTS section_num  SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS order_num    SMALLINT NOT NULL DEFAULT 0;

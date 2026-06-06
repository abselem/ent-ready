-- Add Грамотность чтения slot to ENT attempts
ALTER TABLE ent_attempts ADD COLUMN IF NOT EXISTS score5 SMALLINT; -- Грамотность чтения (max 10)

INSERT INTO topics (name) VALUES ('Грамотность чтения') ON CONFLICT (name) DO NOTHING;

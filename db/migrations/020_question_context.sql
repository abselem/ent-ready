CREATE TABLE IF NOT EXISTS question_contexts (
  id          SERIAL PRIMARY KEY,
  title       TEXT,
  body        TEXT NOT NULL,
  image_url   TEXT,
  topic_id    INT REFERENCES topics(id),
  subtopic_id INT REFERENCES subtopics(id),
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS context_id INT REFERENCES question_contexts(id) ON DELETE CASCADE;

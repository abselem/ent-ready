-- difficulty on questions: 1=легкий, 2=средний, 3=сложный
ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty SMALLINT NOT NULL DEFAULT 1;

-- topic on tests (ENT subject this test covers)
ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_id INT REFERENCES topics(id);

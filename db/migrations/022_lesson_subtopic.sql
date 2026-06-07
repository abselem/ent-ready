ALTER TABLE lessons ADD COLUMN IF NOT EXISTS subtopic_id INT REFERENCES subtopics(id);

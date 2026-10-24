-- Existing question banks remain private until their owners explicitly opt in.
ALTER TABLE questions ADD COLUMN generation_allowed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tests ADD COLUMN generated_for INT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_tests_generated_for ON tests(generated_for) WHERE generated_for IS NOT NULL;

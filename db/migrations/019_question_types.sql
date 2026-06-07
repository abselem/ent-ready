-- question types: single | multi | matching
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'single';

-- explanation can have an image
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation_image_url TEXT;

-- for matching pairs: text = left item, match_text = correct right item
ALTER TABLE answer_options ADD COLUMN IF NOT EXISTS match_text TEXT;

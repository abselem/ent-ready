-- Group category: platform = "От нас", course = "Курс", school = "Школа"
ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'school'
        CHECK (category IN ('platform', 'course', 'school'));

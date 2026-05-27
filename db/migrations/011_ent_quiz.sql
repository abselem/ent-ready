-- ENT auto-quiz: one attempt per session, questions drawn randomly from bank
CREATE TABLE ent_attempts (
    id          SERIAL      PRIMARY KEY,
    user_id     INT         NOT NULL REFERENCES users(id),
    subject3_id INT         REFERENCES topics(id),   -- profile subject 1
    subject4_id INT         REFERENCES topics(id),   -- profile subject 2
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    -- per-slot scores (null = not finished)
    score1      SMALLINT,   -- Мат. грамотность  (max 10)
    score2      SMALLINT,   -- История Казахстана (max 20)
    score3      SMALLINT,   -- Profile 1          (max 50: 30×1 + 10×2)
    score4      SMALLINT    -- Profile 2          (max 50)
);

-- Which questions were assigned to which slot in this attempt
CREATE TABLE ent_attempt_questions (
    attempt_id  INT      NOT NULL REFERENCES ent_attempts(id) ON DELETE CASCADE,
    question_id INT      NOT NULL REFERENCES questions(id),
    slot        SMALLINT NOT NULL,   -- 1=MG, 2=HK, 3=profile1, 4=profile2
    order_num   SMALLINT NOT NULL,
    PRIMARY KEY (attempt_id, question_id)
);

-- Selected options per question (multiple rows allowed for multi-answer questions)
CREATE TABLE ent_selected_options (
    attempt_id  INT NOT NULL REFERENCES ent_attempts(id) ON DELETE CASCADE,
    question_id INT NOT NULL REFERENCES questions(id),
    option_id   INT NOT NULL REFERENCES answer_options(id),
    PRIMARY KEY (attempt_id, question_id, option_id)
);

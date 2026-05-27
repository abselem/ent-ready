-- ============================================================
-- 001_init.sql  —  initial schema
-- ============================================================

-- ------------------------------------------------------------
-- roles
-- ------------------------------------------------------------
CREATE TABLE roles (
    id   SERIAL      PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

INSERT INTO roles (code, name) VALUES
    ('teacher',       'Учитель'),
    ('student',       'Ученик'),
    ('self_learning', 'Самообучение');

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
    id               SERIAL       PRIMARY KEY,
    phone            VARCHAR(15)  NOT NULL,
    first_name       VARCHAR(100) NOT NULL,
    last_name        VARCHAR(100) NOT NULL,
    middle_name      VARCHAR(100),
    city             VARCHAR(100),
    role_id          INT          NOT NULL REFERENCES roles(id),
    password_hash    VARCHAR(255),
    telegram_chat_id BIGINT       UNIQUE,
    is_banned        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_users_phone   ON users(phone);
CREATE UNIQUE INDEX uq_users_tg_chat ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- ------------------------------------------------------------
-- groups
-- ------------------------------------------------------------
CREATE TABLE groups (
    id         SERIAL       PRIMARY KEY,
    name       VARCHAR(20)  NOT NULL,
    city       VARCHAR(100) NOT NULL,
    school     VARCHAR(255) NOT NULL,
    teacher_id INT          NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_groups_identity ON groups(city, school, name);

-- ------------------------------------------------------------
-- user_groups  (один ученик — одна группа)
-- ------------------------------------------------------------
CREATE TABLE user_groups (
    id        SERIAL      PRIMARY KEY,
    user_id   INT         NOT NULL UNIQUE REFERENCES users(id),
    group_id  INT         NOT NULL REFERENCES groups(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ban_log
-- ------------------------------------------------------------
CREATE TABLE ban_log (
    id          SERIAL      PRIMARY KEY,
    user_id     INT         NOT NULL REFERENCES users(id),
    banned_by   INT         NOT NULL REFERENCES users(id),
    reason      TEXT,
    banned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unbanned_at TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- otp_codes
-- ------------------------------------------------------------
CREATE TABLE otp_codes (
    id         SERIAL      PRIMARY KEY,
    phone      VARCHAR(15) NOT NULL,
    code       VARCHAR(255) NOT NULL,           -- bcrypt hash
    purpose    VARCHAR(30) NOT NULL,             -- register / login / reset_password
    attempts   SMALLINT    NOT NULL DEFAULT 0,
    is_used    BOOLEAN     NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_phone   ON otp_codes(phone);
CREATE INDEX idx_otp_expires ON otp_codes(expires_at);

-- ------------------------------------------------------------
-- sessions  (refresh-токены)
-- ------------------------------------------------------------
CREATE TABLE sessions (
    id          SERIAL       PRIMARY KEY,
    user_id     INT          NOT NULL REFERENCES users(id),
    token_hash  VARCHAR(255) NOT NULL,           -- bcrypt hash
    device_info VARCHAR(255),
    ip          VARCHAR(45),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------------------
-- sms_log  (лог отправок OTP)
-- ------------------------------------------------------------
CREATE TABLE sms_log (
    id                  SERIAL       PRIMARY KEY,
    phone               VARCHAR(15)  NOT NULL,
    purpose             VARCHAR(30)  NOT NULL,
    provider            VARCHAR(50)  NOT NULL,   -- telegram / sms / whatsapp
    status              VARCHAR(20)  NOT NULL,   -- sent / failed / delivered
    provider_message_id VARCHAR(255),
    sent_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sms_phone_sent ON sms_log(phone, sent_at);

-- ------------------------------------------------------------
-- auto-update updated_at via trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_groups_updated_at
    BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

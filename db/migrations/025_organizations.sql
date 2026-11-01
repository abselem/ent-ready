CREATE TABLE organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    timezone TEXT NOT NULL DEFAULT 'Asia/Qyzylorda',
    locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'kk')),
    grading_scale TEXT NOT NULL DEFAULT 'points' CHECK (grading_scale IN ('points', '5', '10', '100')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'student', 'parent')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_members_user_active_idx ON organization_members(user_id, organization_id) WHERE status = 'active';

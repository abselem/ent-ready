-- Allow up to 2 groups per student (was UNIQUE on user_id alone)
ALTER TABLE user_groups DROP CONSTRAINT user_groups_user_id_key;
ALTER TABLE user_groups ADD CONSTRAINT uq_user_group_membership UNIQUE (user_id, group_id);

-- Invite code that teachers share with students so they can self-join
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_code VARCHAR(8) NOT NULL DEFAULT '';
-- Seed existing groups with a deterministic code (teachers can share it)
UPDATE groups SET invite_code = UPPER(SUBSTR(MD5(id::TEXT || name), 1, 6))
WHERE invite_code = '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_invite_code ON groups(invite_code) WHERE invite_code != '';

-- Two ENT profile subjects per student
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_subject1 INT REFERENCES topics(id),
  ADD COLUMN IF NOT EXISTS profile_subject2 INT REFERENCES topics(id);

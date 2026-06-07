-- Add email as primary identifier; make phone optional
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users(email) WHERE email IS NOT NULL;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ALTER COLUMN phone SET DEFAULT NULL;

-- Add email column to otp_codes, make phone optional
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE otp_codes ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE otp_codes ALTER COLUMN phone SET DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

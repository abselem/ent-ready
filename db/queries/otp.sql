-- name: CreateOTPCode :one
INSERT INTO otp_codes (phone, code, purpose, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetActiveOTPCode :one
SELECT * FROM otp_codes
WHERE phone = $1
  AND purpose = $2
  AND is_used = FALSE
  AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementOTPAttempts :exec
UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1;

-- name: MarkOTPUsed :exec
UPDATE otp_codes SET is_used = TRUE WHERE id = $1;

-- name: DeleteExpiredOTPCodes :exec
DELETE FROM otp_codes WHERE expires_at < NOW();

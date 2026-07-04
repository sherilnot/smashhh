-- Employment type migration (idempotent)
-- Distinguishes permanent vs casual employees for wage management

ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20)
  CHECK (employment_type IN ('permanent', 'casual'));

-- Default existing employees to 'permanent' so nothing is left null
UPDATE users SET employment_type = 'permanent'
  WHERE role = 'employee' AND employment_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_employment_type ON users(employment_type);

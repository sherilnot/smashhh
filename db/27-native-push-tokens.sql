-- Native (iOS app) push notification device tokens.
-- The iOS app can't use Web Push, so it registers an APNs device token instead.
-- A token belongs to one device; if a different employee logs in on that
-- device, the row is reassigned to them.

CREATE TABLE IF NOT EXISTS native_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_native_push_tokens_employee ON native_push_tokens(employee_id);

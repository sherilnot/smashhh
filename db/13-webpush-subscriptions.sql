-- Add web push subscriptions table for Web Push API
-- This stores push subscription endpoints and keys for sending notifications

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_employee ON web_push_subscriptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_created ON web_push_subscriptions(created_at);

COMMENT ON TABLE web_push_subscriptions IS 'Stores Web Push API subscriptions for sending push notifications';
COMMENT ON COLUMN web_push_subscriptions.endpoint IS 'Push service endpoint URL';
COMMENT ON COLUMN web_push_subscriptions.p256dh IS 'Client public key for encryption';
COMMENT ON COLUMN web_push_subscriptions.auth IS 'Client authentication secret';

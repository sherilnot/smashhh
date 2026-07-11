-- Add push notification subscriptions table
-- This allows employees to subscribe to browser notifications for shift booking reminders

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, subscription_data)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee ON push_subscriptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_created ON push_subscriptions(created_at);

COMMENT ON TABLE push_subscriptions IS 'Stores browser notification subscriptions for employees';
COMMENT ON COLUMN push_subscriptions.subscription_data IS 'JSON object containing subscription details';

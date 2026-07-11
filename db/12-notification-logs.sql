-- Add notification logs table for tracking notification delivery
-- This allows monitoring which notifications were sent, viewed, and clicked

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  channel VARCHAR(50) NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMP NULL,
  clicked BOOLEAN DEFAULT FALSE,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_employee ON notification_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type ON notification_logs(notification_type);

COMMENT ON TABLE notification_logs IS 'Tracks all notifications sent to employees';
COMMENT ON COLUMN notification_logs.notification_type IS 'Type of notification (e.g., shift_booking_reminder)';
COMMENT ON COLUMN notification_logs.channel IS 'How it was sent (browser, email, sms)';
COMMENT ON COLUMN notification_logs.viewed_at IS 'When the notification was viewed';
COMMENT ON COLUMN notification_logs.clicked IS 'Whether the notification was clicked';

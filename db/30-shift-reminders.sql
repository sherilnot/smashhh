-- When the "your shift starts in 3 hours" push was sent for a booking, so each
-- shift is reminded only once (see services/shiftReminderService.js).
ALTER TABLE shift_bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;

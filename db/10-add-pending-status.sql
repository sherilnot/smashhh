-- Add 'pending' status to shift_bookings booking_status column
-- This allows employees to submit shift requests that await manager approval

ALTER TABLE shift_bookings 
DROP CONSTRAINT IF EXISTS shift_bookings_booking_status_check;

ALTER TABLE shift_bookings
ADD CONSTRAINT shift_bookings_booking_status_check 
CHECK (booking_status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));

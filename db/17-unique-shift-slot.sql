-- Fix: no constraint existed preventing two identical shifts (same store,
-- same start/end time) from being created concurrently by the "find or
-- create shift" logic in book-weekly-shifts and roster/assign. Two requests
-- racing each other could both pass the "does this shift exist?" check
-- before either had inserted, producing two separate shift rows for the same
-- slot and silently doubling that slot's effective capacity.
--
-- Note: shifts without a store_id (store_id IS NULL) are intentionally left
-- unconstrained here, since NULL is never considered equal to NULL by a
-- standard unique index — this only dedupes store-owned shifts, which is the
-- only case the affected code paths create.

-- First, collapse any existing duplicates (same store_id + start_time +
-- end_time) down to one canonical row, repointing shift_bookings first so no
-- bookings are lost.
BEGIN;

WITH ranked AS (
  SELECT id, store_id, start_time, end_time,
         ROW_NUMBER() OVER (PARTITION BY store_id, start_time, end_time ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY store_id, start_time, end_time ORDER BY created_at ASC) AS canonical_id
  FROM shifts
  WHERE store_id IS NOT NULL
)
UPDATE shift_bookings sb
SET shift_id = r.canonical_id
FROM ranked r
WHERE sb.shift_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, store_id, start_time, end_time,
         ROW_NUMBER() OVER (PARTITION BY store_id, start_time, end_time ORDER BY created_at ASC) AS rn
  FROM shifts
  WHERE store_id IS NOT NULL
)
DELETE FROM shifts WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- The actual fix.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_store_shift_slot
  ON shifts (store_id, start_time, end_time)
  WHERE store_id IS NOT NULL;

COMMIT;

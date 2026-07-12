-- Fix: stores.name had no unique constraint, so "ON CONFLICT DO NOTHING" in
-- the seed script was a silent no-op — every re-run created a fresh duplicate
-- store row with the same name, and reassigned managers to it. This migration
-- (1) collapses any existing duplicates down to one canonical row per name,
-- repointing all foreign keys first, then (2) adds the missing unique
-- constraint so it can never happen again.

BEGIN;

-- Repoint store_manager_assignments to the earliest-created row per name
WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE store_manager_assignments sma
SET store_id = r.canonical_id
FROM ranked r
WHERE sma.store_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM store_manager_assignments existing
    WHERE existing.store_id = r.canonical_id AND existing.manager_id = sma.manager_id
  );

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE store_employee_assignments sea
SET store_id = r.canonical_id
FROM ranked r
WHERE sea.store_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM store_employee_assignments existing
    WHERE existing.employee_id = sea.employee_id
  );

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE store_checklist_templates sct
SET store_id = r.canonical_id
FROM ranked r
WHERE sct.store_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE store_checklists sc
SET store_id = r.canonical_id
FROM ranked r
WHERE sc.store_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM store_checklists existing
    WHERE existing.store_id = r.canonical_id AND existing.check_date = sc.check_date
  );

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE shifts s
SET store_id = r.canonical_id
FROM ranked r
WHERE s.store_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE timesheets t
SET store_id = r.canonical_id
FROM ranked r
WHERE t.store_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM timesheets existing
    WHERE existing.store_id = r.canonical_id AND existing.week_start = t.week_start
  );

WITH ranked AS (
  SELECT id, name,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY name ORDER BY created_at ASC) AS canonical_id
  FROM stores
)
UPDATE received_invoices ri
SET store_id = r.canonical_id
FROM ranked r
WHERE ri.store_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM received_invoices existing
    WHERE existing.store_id = r.canonical_id AND existing.invoice_date = ri.invoice_date
  );

-- Now safe to delete the now-unreferenced duplicate rows (any remaining
-- foreign-key references that couldn't be repointed above will simply block
-- the delete below with a clear error rather than silently losing data).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
  FROM stores
)
DELETE FROM stores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- The actual fix: prevent this class of bug from ever recurring.
ALTER TABLE stores ADD CONSTRAINT stores_name_unique UNIQUE (name);

COMMIT;

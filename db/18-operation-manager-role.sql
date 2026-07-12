-- Add 'operation_manager' as a valid user role. Placeholder role for now —
-- gets its own login and a bare dashboard; actual functionality to follow.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('employee', 'store_manager', 'warehouse_manager', 'receiving_manager', 'operation_manager'));

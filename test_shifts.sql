-- Create test shifts for temporary assignment testing
-- This creates shifts for next week (Sep 29 - Oct 5, 2026) at different stores

-- Get store IDs first
DO $$
DECLARE
  seaford_id UUID;
  storeb_id UUID;
  storec_id UUID;
  stored_id UUID;
  base_date DATE := '2026-09-29'; -- Monday next week
BEGIN
  -- Get store IDs
  SELECT id INTO seaford_id FROM stores WHERE name = 'Rizin''s Seaford';
  SELECT id INTO storeb_id FROM stores WHERE name = 'Store B';
  SELECT id INTO storec_id FROM stores WHERE name = 'Store C';
  SELECT id INTO stored_id FROM stores WHERE name = 'Store D';

  -- Monday Sep 29 - Shifts at Rizin's Seaford
  INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
  VALUES 
    (base_date + INTERVAL '11 hours', base_date + INTERVAL '15 hours', 'Rizin''s Seaford', 3, seaford_id),
    (base_date + INTERVAL '15 hours', base_date + INTERVAL '21 hours', 'Rizin''s Seaford', 4, seaford_id);

  -- Tuesday Sep 30 - Shifts at Store B
  INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
  VALUES 
    ((base_date + INTERVAL '1 day') + INTERVAL '11 hours', (base_date + INTERVAL '1 day') + INTERVAL '15 hours', 'Store B', 3, storeb_id),
    ((base_date + INTERVAL '1 day') + INTERVAL '15 hours', (base_date + INTERVAL '1 day') + INTERVAL '21 hours', 'Store B', 4, storeb_id);

  -- Wednesday Oct 1 - Shifts at Store C
  INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
  VALUES 
    ((base_date + INTERVAL '2 days') + INTERVAL '11 hours', (base_date + INTERVAL '2 days') + INTERVAL '15 hours', 'Store C', 2, storec_id),
    ((base_date + INTERVAL '2 days') + INTERVAL '15 hours', (base_date + INTERVAL '2 days') + INTERVAL '21 hours', 'Store C', 3, storec_id);

  -- Thursday Oct 2 - Shifts at Store D
  INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
  VALUES 
    ((base_date + INTERVAL '3 days') + INTERVAL '11 hours', (base_date + INTERVAL '3 days') + INTERVAL '15 hours', 'Store D', 3, stored_id),
    ((base_date + INTERVAL '3 days') + INTERVAL '15 hours', (base_date + INTERVAL '3 days') + INTERVAL '21 hours', 'Store D', 4, stored_id);

  -- Friday Oct 3 - Shifts at all stores
  INSERT INTO shifts (start_time, end_time, store_location, capacity, store_id)
  VALUES 
    ((base_date + INTERVAL '4 days') + INTERVAL '11 hours', (base_date + INTERVAL '4 days') + INTERVAL '15 hours', 'Rizin''s Seaford', 4, seaford_id),
    ((base_date + INTERVAL '4 days') + INTERVAL '15 hours', (base_date + INTERVAL '4 days') + INTERVAL '21 hours', 'Store B', 4, storeb_id);

  RAISE NOTICE 'Test shifts created successfully for Sep 29 - Oct 3, 2026';
END $$;

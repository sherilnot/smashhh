-- Add unit_price to received_invoice_items so shop managers can see pricing
-- and the total value of each delivery line.

ALTER TABLE received_invoice_items
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2) DEFAULT 0;

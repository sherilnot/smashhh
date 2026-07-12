-- Cash submissions: shop managers send photos of liquid cash with amount and notes to OM001

CREATE TABLE IF NOT EXISTS cash_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cs_store ON cash_submissions(store_id);
CREATE INDEX IF NOT EXISTS idx_cs_status ON cash_submissions(status);
CREATE INDEX IF NOT EXISTS idx_cs_date ON cash_submissions(submitted_at);

CREATE TABLE IF NOT EXISTS cash_submission_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES cash_submissions(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csi_submission ON cash_submission_images(submission_id);

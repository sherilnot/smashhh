-- Add video support to maintenance reports

CREATE TABLE IF NOT EXISTS maintenance_report_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES maintenance_reports(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size BIGINT
);

CREATE INDEX IF NOT EXISTS idx_mrv_report ON maintenance_report_videos(report_id);

-- Published rosters: snapshot of weekly roster sent by manager to employees
CREATE TABLE IF NOT EXISTS published_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  published_by UUID NOT NULL REFERENCES users(id),
  published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  roster_data JSONB NOT NULL,
  CONSTRAINT unique_published_roster UNIQUE (store_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_pr_store ON published_rosters(store_id);
CREATE INDEX IF NOT EXISTS idx_pr_week ON published_rosters(week_start);

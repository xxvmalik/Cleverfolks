-- Stage 15.1 Part C: Add no-show count and re-engagement tracking to pipeline

ALTER TABLE skyler_sales_pipeline
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS re_engagement_status TEXT DEFAULT 'none'
    CHECK (re_engagement_status IN ('none', 'active', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS re_engagement_touch INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS re_engagement_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_re_engagement_action JSONB,
  ADD COLUMN IF NOT EXISTS next_re_engagement_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pipeline_reengagement_active
  ON skyler_sales_pipeline(re_engagement_status) WHERE re_engagement_status = 'active';

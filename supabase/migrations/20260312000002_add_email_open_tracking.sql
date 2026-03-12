-- Phase 2: Email open tracking
-- Tracks when recipients open Skyler's outreach emails via a 1x1 tracking pixel.

-- ── 1. Create skyler_email_opens table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_email_opens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tracking_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  cadence_step INT NOT NULL DEFAULT 1,
  open_count INT DEFAULT 0,
  first_opened_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_opens_tracking
  ON skyler_email_opens(tracking_id);

CREATE INDEX IF NOT EXISTS idx_email_opens_pipeline
  ON skyler_email_opens(pipeline_id);

-- RLS — tracking pixel endpoint uses admin client, but allow workspace members to read
ALTER TABLE skyler_email_opens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'skyler_email_opens' AND policyname = 'email_opens_select'
  ) THEN
    CREATE POLICY email_opens_select ON skyler_email_opens FOR SELECT
      USING (workspace_id IN (
        SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

-- ── 2. Add open tracking columns to skyler_sales_pipeline ────────────────────

ALTER TABLE skyler_sales_pipeline
ADD COLUMN IF NOT EXISTS email_opens INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_email_opened_at TIMESTAMPTZ;

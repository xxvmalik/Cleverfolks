-- Phase 1: Notifications table + escalation columns on pipeline
-- Supports in-app notifications, Slack/email alerts, and escalation state tracking

-- ── 1. Create skyler_notifications table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'lead_replied',
    'draft_awaiting_approval',
    'lead_scored_hot',
    'escalation_triggered',
    'deal_closed_won',
    'deal_closed_lost',
    'objection_received'
  )),
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace
  ON skyler_notifications(workspace_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_pipeline
  ON skyler_notifications(pipeline_id);

-- RLS
ALTER TABLE skyler_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'skyler_notifications' AND policyname = 'notifications_select'
  ) THEN
    CREATE POLICY notifications_select ON skyler_notifications FOR SELECT
      USING (workspace_id IN (
        SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'skyler_notifications' AND policyname = 'notifications_insert'
  ) THEN
    CREATE POLICY notifications_insert ON skyler_notifications FOR INSERT
      WITH CHECK (workspace_id IN (
        SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'skyler_notifications' AND policyname = 'notifications_update'
  ) THEN
    CREATE POLICY notifications_update ON skyler_notifications FOR UPDATE
      USING (workspace_id IN (
        SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

-- ── 2. Add escalation columns to skyler_sales_pipeline ───────────────────────

ALTER TABLE skyler_sales_pipeline
ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS escalation_reasons JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cadence_paused BOOLEAN DEFAULT false;

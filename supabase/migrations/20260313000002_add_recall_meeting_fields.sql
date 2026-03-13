-- Add Recall.ai meeting bot and transcript fields to skyler_sales_pipeline
ALTER TABLE skyler_sales_pipeline
ADD COLUMN IF NOT EXISTS recall_bot_id TEXT,
ADD COLUMN IF NOT EXISTS meeting_transcript TEXT,
ADD COLUMN IF NOT EXISTS meeting_outcome JSONB,
ADD COLUMN IF NOT EXISTS action_notes JSONB DEFAULT '[]'::jsonb;

-- Index for looking up pipeline by recall bot ID (webhook handler)
CREATE INDEX IF NOT EXISTS idx_pipeline_recall_bot
  ON skyler_sales_pipeline(recall_bot_id)
  WHERE recall_bot_id IS NOT NULL;

-- Add new notification event types for action notes
ALTER TABLE skyler_notifications
DROP CONSTRAINT IF EXISTS skyler_notifications_event_type_check;

ALTER TABLE skyler_notifications
ADD CONSTRAINT skyler_notifications_event_type_check
CHECK (event_type IN (
  'lead_replied',
  'draft_awaiting_approval',
  'lead_scored_hot',
  'escalation_triggered',
  'deal_closed_won',
  'deal_closed_lost',
  'objection_received',
  'meeting_booked',
  'action_note_due'
));

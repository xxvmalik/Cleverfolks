-- Add meeting detection columns to skyler_sales_pipeline
ALTER TABLE skyler_sales_pipeline
ADD COLUMN IF NOT EXISTS meeting_event_id TEXT,
ADD COLUMN IF NOT EXISTS meeting_details JSONB;

-- Unique index for dedup: one calendar event can only resolve one pipeline record
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_meeting_event
  ON skyler_sales_pipeline(meeting_event_id)
  WHERE meeting_event_id IS NOT NULL;

-- Add 'meeting_booked' to notification event types
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
  'meeting_booked'
));

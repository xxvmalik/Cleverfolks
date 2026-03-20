-- Add meeting_outcome_reason to calendar_events
-- Stores the actual outcome when a meeting has no transcript.
-- Determined by querying the Recall API for bot status and participant data.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS meeting_outcome_reason TEXT DEFAULT NULL;

-- Allowed values: nobody_joined, lead_no_show, user_no_show, recording_failed, completed
ALTER TABLE calendar_events
  ADD CONSTRAINT chk_meeting_outcome_reason
  CHECK (meeting_outcome_reason IS NULL OR meeting_outcome_reason IN (
    'nobody_joined',
    'lead_no_show',
    'user_no_show',
    'recording_failed',
    'completed'
  ));

COMMENT ON COLUMN calendar_events.meeting_outcome_reason IS 'Actual meeting outcome when no transcript exists. Determined from Recall bot status_changes and meeting_participants.';

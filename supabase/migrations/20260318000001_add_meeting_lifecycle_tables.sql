-- Stage 13: Meeting Lifecycle System — Unified schema
-- Three new tables: calendar_connections, calendar_events, meeting_health_signals

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. calendar_connections — tracks which calendar platform each user connected
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'microsoft_outlook', 'calendly')),
  provider_email TEXT,
  recall_calendar_id TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  oauth_status TEXT DEFAULT 'connected',
  work_hours_start TIME DEFAULT '09:00',
  work_hours_end TIME DEFAULT '17:00',
  work_days JSONB DEFAULT '[1,2,3,4,5]',
  timezone TEXT DEFAULT 'UTC',
  calendly_event_types JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_workspace
  ON calendar_connections(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_connections_provider
  ON calendar_connections(workspace_id, provider)
  WHERE oauth_status = 'connected';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. calendar_events — normalised events from ALL platforms
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_connection_id UUID REFERENCES calendar_connections(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  ical_uid TEXT,
  title TEXT,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  timezone TEXT,
  location TEXT,
  meeting_url TEXT,
  meeting_provider TEXT, -- zoom, google_meet, teams, webex
  organizer_email TEXT,
  organizer_name TEXT,
  attendees JSONB DEFAULT '[]',
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'tentative')),
  event_type TEXT, -- intro, demo, deep_dive, negotiation, check_in
  lead_id UUID,
  recall_bot_id TEXT,
  recall_bot_status TEXT,
  no_show_detected BOOLEAN DEFAULT false,
  reschedule_count INTEGER DEFAULT 0,
  previous_event_id UUID REFERENCES calendar_events(id),
  calendly_invitee_uri TEXT,
  form_answers JSONB,
  pre_call_brief_sent BOOLEAN DEFAULT false,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(calendar_connection_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace
  ON calendar_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_lead
  ON calendar_events(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_start
  ON calendar_events(workspace_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_no_show
  ON calendar_events(workspace_id, no_show_detected)
  WHERE no_show_detected = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. meeting_health_signals — pattern detection alerts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meeting_health_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  lead_id UUID,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'no_show', 'reschedule', 'decline', 'new_attendee', 'fatigue', 'duration_drop'
  )),
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  event_id UUID REFERENCES calendar_events(id),
  details JSONB,
  acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_signals_workspace
  ON meeting_health_signals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_health_signals_lead
  ON meeting_health_signals(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_signals_unacknowledged
  ON meeting_health_signals(workspace_id, acknowledged)
  WHERE acknowledged = false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Expand notification event_type constraint for new meeting events
-- ═══════════════════════════════════════════════════════════════════════════════

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
  'action_note_due',
  'info_requested',
  'meeting_cancelled',
  'meeting_no_show',
  'meeting_rescheduled',
  'new_attendee_detected',
  'pre_call_brief',
  'health_signal'
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Add Calendly event type → pipeline stage mapping to workspaces
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS calendly_stage_mapping JSONB DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. CRM activity dedup table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  lead_id UUID,
  activity_type TEXT NOT NULL,
  activity_hash TEXT NOT NULL,
  hubspot_object_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_activity_dedup
  ON crm_activity_log(workspace_id, activity_hash);

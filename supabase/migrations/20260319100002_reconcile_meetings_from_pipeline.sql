-- Reconcile meeting data: create calendar_events and meeting_transcripts rows
-- from pipeline records that have meeting data in the old format.
--
-- Handles the edge case where meeting_details timestamps have extra precision
-- (7+ decimal places from Outlook) by trimming to valid PostgreSQL precision.

-- 1. Create calendar_events for pipeline records with meeting_event_id
INSERT INTO calendar_events (
  workspace_id,
  provider,
  provider_event_id,
  title,
  start_time,
  end_time,
  meeting_url,
  attendees,
  status,
  lead_id,
  recall_bot_id
)
SELECT
  p.workspace_id,
  CASE
    WHEN p.meeting_event_id LIKE 'gcal-%' THEN 'google_calendar'
    WHEN p.meeting_event_id LIKE 'outlook-%' THEN 'microsoft_outlook'
    WHEN p.meeting_event_id LIKE 'calendly-%' THEN 'calendly'
    ELSE 'unknown'
  END,
  CASE
    WHEN p.meeting_event_id LIKE 'gcal-%' THEN SUBSTRING(p.meeting_event_id FROM 6)
    WHEN p.meeting_event_id LIKE 'outlook-%' THEN SUBSTRING(p.meeting_event_id FROM 9)
    WHEN p.meeting_event_id LIKE 'calendly-%' THEN SUBSTRING(p.meeting_event_id FROM 10)
    ELSE p.meeting_event_id
  END,
  COALESCE(p.meeting_details->>'title', 'Meeting with ' || p.contact_name),
  -- Trim timestamps to 6 decimal places max to avoid PostgreSQL precision errors
  COALESCE(
    LEFT(p.meeting_details->>'start', 26)::timestamptz,
    p.updated_at
  ),
  COALESCE(
    LEFT(p.meeting_details->>'end', 26)::timestamptz,
    p.updated_at + INTERVAL '30 minutes'
  ),
  p.meeting_details->>'link',
  jsonb_build_array(jsonb_build_object('email', p.contact_email)),
  'confirmed',
  p.id,
  p.recall_bot_id
FROM skyler_sales_pipeline p
WHERE p.meeting_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM calendar_events ce
    WHERE ce.lead_id = p.id
  );

-- 2. Create meeting_transcripts for pipeline records that have transcript data
--    but no corresponding meeting_transcripts row
INSERT INTO meeting_transcripts (
  bot_id,
  workspace_id,
  lead_id,
  meeting_url,
  meeting_date,
  summary,
  processing_status
)
SELECT
  p.recall_bot_id,
  p.workspace_id,
  p.id,
  p.meeting_details->>'link',
  COALESCE(
    LEFT(p.meeting_details->>'start', 26)::timestamptz,
    p.updated_at
  ),
  CASE
    WHEN p.meeting_outcome IS NOT NULL THEN
      COALESCE(
        p.meeting_outcome->>'executive_summary',
        'Meeting processed — see pipeline record for details'
      )
    ELSE NULL
  END,
  CASE
    WHEN p.meeting_outcome IS NOT NULL THEN 'complete'
    WHEN p.meeting_transcript IS NOT NULL THEN 'pending'
    ELSE 'pending'
  END
FROM skyler_sales_pipeline p
WHERE p.meeting_event_id IS NOT NULL
  AND (p.meeting_transcript IS NOT NULL OR p.meeting_outcome IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM meeting_transcripts mt
    WHERE mt.lead_id = p.id
  );

-- 3. Link recall_bots to calendar_events
UPDATE calendar_events ce
SET recall_bot_id = rb.recall_bot_id,
    recall_bot_status = rb.status
FROM recall_bots rb
WHERE rb.lead_id = ce.lead_id
  AND rb.workspace_id = ce.workspace_id
  AND ce.recall_bot_id IS NULL;

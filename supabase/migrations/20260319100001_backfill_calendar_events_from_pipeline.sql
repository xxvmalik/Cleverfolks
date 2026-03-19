-- Backfill calendar_events from existing skyler_sales_pipeline records
-- that have meeting_event_id set but no corresponding calendar_events row.
--
-- The meeting_details JSONB on pipeline records contains:
--   { title, start, end, link, provider, detected_at }
--
-- This ensures existing detected meetings are visible in the lead-meetings UI.

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
  lead_id
)
SELECT
  p.workspace_id,
  CASE
    WHEN p.meeting_event_id LIKE 'gcal-%' THEN 'google_calendar'
    WHEN p.meeting_event_id LIKE 'outlook-%' THEN 'microsoft_outlook'
    WHEN p.meeting_event_id LIKE 'calendly-%' THEN 'calendly'
    ELSE 'unknown'
  END AS provider,
  -- Strip the prefix to get the raw provider_event_id
  CASE
    WHEN p.meeting_event_id LIKE 'gcal-%' THEN SUBSTRING(p.meeting_event_id FROM 6)
    WHEN p.meeting_event_id LIKE 'outlook-%' THEN SUBSTRING(p.meeting_event_id FROM 9)
    WHEN p.meeting_event_id LIKE 'calendly-%' THEN SUBSTRING(p.meeting_event_id FROM 10)
    ELSE p.meeting_event_id
  END AS provider_event_id,
  COALESCE(p.meeting_details->>'title', 'Meeting with ' || p.contact_name) AS title,
  COALESCE(
    (p.meeting_details->>'start')::timestamptz,
    p.updated_at
  ) AS start_time,
  COALESCE(
    (p.meeting_details->>'end')::timestamptz,
    p.updated_at + INTERVAL '30 minutes'
  ) AS end_time,
  p.meeting_details->>'link' AS meeting_url,
  jsonb_build_array(jsonb_build_object('email', p.contact_email)) AS attendees,
  'confirmed' AS status,
  p.id AS lead_id
FROM skyler_sales_pipeline p
WHERE p.meeting_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM calendar_events ce
    WHERE ce.workspace_id = p.workspace_id
      AND ce.provider_event_id = CASE
        WHEN p.meeting_event_id LIKE 'gcal-%' THEN SUBSTRING(p.meeting_event_id FROM 6)
        WHEN p.meeting_event_id LIKE 'outlook-%' THEN SUBSTRING(p.meeting_event_id FROM 9)
        WHEN p.meeting_event_id LIKE 'calendly-%' THEN SUBSTRING(p.meeting_event_id FROM 10)
        ELSE p.meeting_event_id
      END
  );

-- Also backfill lead_id on any recall_bots records that have a matching calendar_event
UPDATE calendar_events ce
SET recall_bot_id = rb.recall_bot_id,
    recall_bot_status = rb.status
FROM recall_bots rb
WHERE rb.lead_id = ce.lead_id
  AND rb.workspace_id = ce.workspace_id
  AND ce.recall_bot_id IS NULL;

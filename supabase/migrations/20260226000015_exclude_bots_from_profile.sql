-- ============================================================
-- Fix 3: Exclude bot and integration accounts from all
-- profile builder SQL functions.
-- Previously only '%bot%' was filtered; this adds coverage
-- for nango, integration, developer, and workspace-specific
-- bot accounts like cleverfolks_ai.
-- ============================================================

-- ── get_team_activity (updated) ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_team_activity(p_workspace_id uuid)
RETURNS TABLE (
  user_name       text,
  message_count   bigint,
  directive_count bigint,
  response_count  bigint,
  channel_set     text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(dc.metadata->>'user_name', dc.metadata->>'user')             AS user_name,
    COUNT(*)                                                               AS message_count,
    COUNT(*) FILTER (
      WHERE dc.chunk_text ~*
        '\m(please|assign|follow.?up|escalate|remind|make sure|ensure|review|approve|deploy|send|schedule|confirm)\M'
    )                                                                      AS directive_count,
    COUNT(*) FILTER (
      WHERE dc.metadata->>'thread_ts' IS NOT NULL
        AND dc.metadata->>'ts'        IS NOT NULL
        AND dc.metadata->>'thread_ts' != dc.metadata->>'ts'
    )                                                                      AS response_count,
    ARRAY_AGG(DISTINCT dc.metadata->>'channel_name')
      FILTER (WHERE dc.metadata->>'channel_name' IS NOT NULL)             AS channel_set
  FROM  document_chunks dc
  JOIN  synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND sd.source_type IN ('slack_message', 'slack_reply')
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') IS NOT NULL
    -- Exclude bots and integration accounts
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%nango%'
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%integration%'
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%developer%'
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE 'cleverfolks%'
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE 'slackbot%'
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 50;
$$;

-- ── get_person_samples_bulk (updated) ─────────────────────────────────────────
-- Defence-in-depth: also filter bots here even though callers should already
-- pass only names returned by get_team_activity.

CREATE OR REPLACE FUNCTION get_person_samples_bulk(
  p_workspace_id       uuid,
  p_person_names       text[],
  p_samples_per_person int DEFAULT 8
)
RETURNS TABLE (
  user_name    text,
  chunk_text   text,
  channel_name text,
  msg_ts       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.user_name,
    t.chunk_text,
    t.channel_name,
    t.msg_ts
  FROM (
    SELECT
      COALESCE(dc.metadata->>'user_name', dc.metadata->>'user')   AS user_name,
      dc.chunk_text,
      dc.metadata->>'channel_name'                                 AS channel_name,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                            AS msg_ts,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(dc.metadata->>'user_name', dc.metadata->>'user')
        ORDER BY RANDOM()
      )                                                            AS rn
    FROM  document_chunks dc
    JOIN  synced_documents sd ON sd.id = dc.document_id
    WHERE dc.workspace_id = p_workspace_id
      AND sd.source_type IN ('slack_message', 'slack_reply')
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') = ANY(p_person_names)
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%nango%'
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%integration%'
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%developer%'
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE 'cleverfolks%'
      AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE 'slackbot%'
      AND length(dc.chunk_text) > 20
  ) t
  WHERE t.rn <= p_samples_per_person;
$$;

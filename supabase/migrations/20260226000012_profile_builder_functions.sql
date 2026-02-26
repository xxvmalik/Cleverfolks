-- ============================================================
-- Sprint 4.5 Profile Overhaul: SQL helper functions for
-- the knowledge profile builder (zero-LLM behavioral signals
-- + bulk message sampling).
-- ============================================================

-- ── get_team_activity ─────────────────────────────────────────────────────────
-- Returns behavioral signals for each person found in Slack messages.
-- Excludes bot-like users. Used to infer roles without any LLM calls.

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
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 50;
$$;

-- ── get_mention_counts ────────────────────────────────────────────────────────
-- Counts @-mentions across all messages.  Used to identify who is frequently
-- tagged (support leads, tech leads, escalation targets, etc.).

CREATE OR REPLACE FUNCTION get_mention_counts(p_workspace_id uuid)
RETURNS TABLE (
  mention_name  text,
  mention_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(m[1])  AS mention_name,
    COUNT(*)     AS mention_count
  FROM  document_chunks dc,
        regexp_matches(dc.chunk_text, '@([A-Za-z0-9._-]{2,})', 'g') AS m
  WHERE dc.workspace_id = p_workspace_id
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 50;
$$;

-- ── get_channel_activity ──────────────────────────────────────────────────────
-- Per-channel message counts, unique speaker counts, and top speaker list.

CREATE OR REPLACE FUNCTION get_channel_activity(p_workspace_id uuid)
RETURNS TABLE (
  channel_name    text,
  message_count   bigint,
  unique_speakers bigint,
  key_speakers    text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dc.metadata->>'channel_name'                                           AS channel_name,
    COUNT(*)                                                               AS message_count,
    COUNT(DISTINCT COALESCE(dc.metadata->>'user_name',
                            dc.metadata->>'user'))                         AS unique_speakers,
    ARRAY_AGG(DISTINCT COALESCE(dc.metadata->>'user_name',
                                dc.metadata->>'user'))
      FILTER (WHERE COALESCE(dc.metadata->>'user_name',
                             dc.metadata->>'user') IS NOT NULL)            AS key_speakers
  FROM  document_chunks dc
  JOIN  synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND sd.source_type IN ('slack_message', 'slack_reply')
    AND dc.metadata->>'channel_name' IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 30;
$$;

-- ── get_person_samples_bulk ───────────────────────────────────────────────────
-- Returns up to p_samples_per_person randomly-selected messages for each
-- person in p_person_names.  Random sampling gives even temporal coverage
-- without requiring explicit time-bucketing.

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
      AND length(dc.chunk_text) > 20
  ) t
  WHERE t.rn <= p_samples_per_person;
$$;

-- ── get_channel_samples_bulk ──────────────────────────────────────────────────
-- Returns up to p_samples_per_channel randomly-selected messages for each
-- channel in p_channel_names.

CREATE OR REPLACE FUNCTION get_channel_samples_bulk(
  p_workspace_id        uuid,
  p_channel_names       text[],
  p_samples_per_channel int DEFAULT 8
)
RETURNS TABLE (
  channel_name text,
  user_name    text,
  chunk_text   text,
  msg_ts       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.channel_name,
    t.user_name,
    t.chunk_text,
    t.msg_ts
  FROM (
    SELECT
      dc.metadata->>'channel_name'                                 AS channel_name,
      COALESCE(dc.metadata->>'user_name', dc.metadata->>'user')   AS user_name,
      dc.chunk_text,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                            AS msg_ts,
      ROW_NUMBER() OVER (
        PARTITION BY dc.metadata->>'channel_name'
        ORDER BY RANDOM()
      )                                                            AS rn
    FROM  document_chunks dc
    JOIN  synced_documents sd ON sd.id = dc.document_id
    WHERE dc.workspace_id = p_workspace_id
      AND sd.source_type IN ('slack_message', 'slack_reply')
      AND dc.metadata->>'channel_name' = ANY(p_channel_names)
      AND length(dc.chunk_text) > 20
  ) t
  WHERE t.rn <= p_samples_per_channel;
$$;

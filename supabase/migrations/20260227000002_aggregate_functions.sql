-- ============================================================
-- Aggregation functions for CleverBrain
-- Used by the "aggregation" query strategy to answer questions
-- like "who reported the most complaints?" or
-- "which channel has the most failed orders?".
--
-- Both functions count DISTINCT messages (documents), not chunks,
-- so a long message split into multiple chunks counts as 1.
-- Optional p_keyword filters chunk_text with ILIKE for topic-scoped counts.
-- ============================================================

-- ── aggregate_by_person ───────────────────────────────────────────────────────
-- Returns message counts per user, ordered highest first.

CREATE OR REPLACE FUNCTION aggregate_by_person(
  p_workspace_id uuid,
  p_channel_name text        DEFAULT NULL,
  p_after        timestamptz DEFAULT NULL,
  p_before       timestamptz DEFAULT NULL,
  p_keyword      text        DEFAULT NULL,
  p_limit        int         DEFAULT 25
)
RETURNS TABLE (
  user_name     text,
  message_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') AS user_name,
    COUNT(DISTINCT dc.document_id)                            AS message_count
  FROM  document_chunks dc
  JOIN  synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND sd.source_type   IN ('slack_message', 'slack_reply')
    -- Exclude bots and anonymous senders
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') IS NOT NULL
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
    -- Optional channel filter
    AND (p_channel_name IS NULL
         OR dc.metadata->>'channel_name' ILIKE '%' || p_channel_name || '%')
    -- Optional time range
    AND (p_after IS NULL OR
         COALESCE(
           CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                THEN to_timestamp((dc.metadata->>'ts')::float)
           END,
           sd.synced_at
         ) >= p_after)
    AND (p_before IS NULL OR
         COALESCE(
           CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                THEN to_timestamp((dc.metadata->>'ts')::float)
           END,
           sd.synced_at
         ) <= p_before)
    -- Optional keyword filter on message text
    AND (p_keyword IS NULL OR dc.chunk_text ILIKE '%' || p_keyword || '%')
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

-- ── aggregate_by_channel ──────────────────────────────────────────────────────
-- Returns message counts per channel, ordered highest first.

CREATE OR REPLACE FUNCTION aggregate_by_channel(
  p_workspace_id uuid,
  p_after        timestamptz DEFAULT NULL,
  p_before       timestamptz DEFAULT NULL,
  p_keyword      text        DEFAULT NULL,
  p_limit        int         DEFAULT 25
)
RETURNS TABLE (
  channel_name  text,
  message_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dc.metadata->>'channel_name'   AS channel_name,
    COUNT(DISTINCT dc.document_id) AS message_count
  FROM  document_chunks dc
  JOIN  synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND sd.source_type   IN ('slack_message', 'slack_reply')
    AND dc.metadata->>'channel_name' IS NOT NULL
    -- Optional time range
    AND (p_after IS NULL OR
         COALESCE(
           CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                THEN to_timestamp((dc.metadata->>'ts')::float)
           END,
           sd.synced_at
         ) >= p_after)
    AND (p_before IS NULL OR
         COALESCE(
           CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                THEN to_timestamp((dc.metadata->>'ts')::float)
           END,
           sd.synced_at
         ) <= p_before)
    -- Optional keyword filter on message text
    AND (p_keyword IS NULL OR dc.chunk_text ILIKE '%' || p_keyword || '%')
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

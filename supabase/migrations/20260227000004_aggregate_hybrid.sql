-- ============================================================
-- Hybrid aggregation functions
-- Used by the hybrid_aggregation search strategy to give Claude
-- exact per-person counts regardless of workspace volume, alongside
-- a fixed 300-message qualitative sample.
--
-- Two complementary functions:
--   1. aggregate_by_person_in_channels  — counts ALL messages per person
--      inside the DEDICATED channels (channels whose purpose fully matches
--      the query topic, e.g. #order-complaints for a complaints query).
--
--   2. aggregate_by_person_keyword_others — counts keyword-matched messages
--      per person in ALL channels EXCEPT the dedicated ones, so mentions of
--      the topic in #general, #team-chat, etc. are not missed.
--
-- The strategy executor calls both in parallel, merges the counts per person
-- (summing dedicated + others), and returns a single synthetic result row.
-- ============================================================

-- ── aggregate_by_person_in_channels ───────────────────────────────────────────
-- Counts ALL messages per person in the specified dedicated channels.
-- No keyword filter — if it's in a dedicated channel we count every message.

CREATE OR REPLACE FUNCTION aggregate_by_person_in_channels(
  p_workspace_id uuid,
  p_channels     text[],
  p_after        timestamptz DEFAULT NULL,
  p_before       timestamptz DEFAULT NULL,
  p_limit        int         DEFAULT 100
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
    -- Must be in one of the dedicated channels
    AND dc.metadata->>'channel_name' = ANY(p_channels)
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
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

-- ── aggregate_by_person_keyword_others ────────────────────────────────────────
-- Counts keyword-matched messages per person across ALL channels EXCEPT
-- the specified dedicated ones (which are counted separately above).
-- Catches mentions of the topic in #general, #team-chat, etc.

CREATE OR REPLACE FUNCTION aggregate_by_person_keyword_others(
  p_workspace_id     uuid,
  p_keywords         text[],
  p_exclude_channels text[]      DEFAULT NULL,
  p_after            timestamptz DEFAULT NULL,
  p_before           timestamptz DEFAULT NULL,
  p_limit            int         DEFAULT 100
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
    -- Exclude dedicated channels (already counted separately)
    AND (p_exclude_channels IS NULL
         OR dc.metadata->>'channel_name' != ALL(p_exclude_channels))
    -- Must match at least one keyword
    AND EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE dc.chunk_text ILIKE '%' || kw || '%'
    )
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
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

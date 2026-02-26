-- ============================================================
-- Sprint 5 Fix: channel diversity in fetch_chunks_by_timerange
-- ============================================================
--
-- Problem: with a simple LIMIT the query was returning lots of
-- chunks from a few busy channels and nothing from quieter ones.
--
-- Fix: distribute the p_limit budget evenly across all channels
-- that have messages in the time window.
--
--   channel_budget = CEIL(p_limit / distinct_channel_count)
--
-- Each channel contributes at most channel_budget chunks
-- (its most-recent ones, picked via ROW_NUMBER DESC so that
-- the final ASC sort presents events chronologically).
--
-- NOTE: COUNT(DISTINCT ...) OVER () is NOT supported by
-- PostgreSQL window functions.  The channel count is computed
-- in a separate CTE and cross-joined in.
--
-- Default limit raised from 50 → 150.

CREATE OR REPLACE FUNCTION fetch_chunks_by_timerange(
  p_workspace_id  uuid,
  p_after         timestamptz DEFAULT NULL,
  p_before        timestamptz DEFAULT NULL,
  p_limit         int         DEFAULT 150
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  chunk_text  text,
  source_type text,
  metadata    jsonb,
  msg_ts      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    -- All chunks whose effective timestamp falls in the requested window.
    -- Effective timestamp = metadata->>'ts' (Slack unix epoch) when present,
    -- otherwise synced_documents.synced_at.
    SELECT
      dc.id                                         AS chunk_id,
      sd.id                                         AS document_id,
      sd.title,
      dc.chunk_text,
      sd.source_type,
      dc.metadata,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                             AS msg_ts
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    WHERE dc.workspace_id = p_workspace_id
      AND (p_after  IS NULL OR
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
  ),
  -- Count distinct channels so we can compute a per-channel budget.
  -- GREATEST(..., 1) avoids divide-by-zero when all channel_ids are NULL
  -- (non-Slack data) — in that case every row goes into one partition
  -- and the full p_limit is available.
  channel_count AS (
    SELECT GREATEST(COUNT(DISTINCT metadata->>'channel_id'), 1)::int AS cnt
    FROM base
  ),
  -- Rank chunks within each channel by recency (newest = rn 1).
  -- CROSS JOIN brings in the channel budget scalar.
  ranked AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        PARTITION BY b.metadata->>'channel_id'
        ORDER BY b.msg_ts DESC
      )                                             AS rn,
      c.cnt                                         AS channel_count
    FROM base b
    CROSS JOIN channel_count c
  )
  -- Keep only the top-N chunks per channel, then sort chronologically.
  SELECT chunk_id, document_id, title, chunk_text, source_type, metadata, msg_ts
  FROM ranked
  WHERE rn <= CEIL(p_limit::float / channel_count)::bigint
  ORDER BY msg_ts ASC
  LIMIT p_limit;
END;
$$;

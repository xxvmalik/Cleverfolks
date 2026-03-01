-- ============================================================
-- Two-level diversity: source_type first, then channel within
-- ============================================================
--
-- Problem: the old diversity logic partitions by channel_id only.
-- Gmail has no channel_id, so all Gmail rows land in one NULL
-- partition.  With 20 Slack channels + 1 Gmail partition the
-- per-partition budget is tiny and Gmail is drowned out.
--
-- Fix: split the p_limit budget evenly across distinct source
-- types first, then spread each source type's budget across its
-- channels.  This naturally degrades to the old behaviour for
-- single-source queries (source_count = 1).
--
-- Examples (p_limit = 150):
--   2 source types → 75 each
--     Slack (20 channels): 75 / 20 ≈ 4 per channel
--     Gmail (no channels): 75 / 1  = 75
--   1 source type (Slack only, 10 channels):
--     150 / 1 = 150 source budget → 150 / 10 = 15 per channel
--     (identical to old behaviour)

CREATE OR REPLACE FUNCTION fetch_chunks_by_timerange(
  p_workspace_id  uuid,
  p_after         timestamptz  DEFAULT NULL,
  p_before        timestamptz  DEFAULT NULL,
  p_limit         int          DEFAULT 150,
  p_source_types  text[]       DEFAULT NULL
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
      AND (p_source_types IS NULL OR sd.source_type = ANY(p_source_types))
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
  -- Level 1: how many distinct source types are in the result set?
  source_type_count AS (
    SELECT GREATEST(COUNT(DISTINCT b.source_type), 1)::int AS cnt
    FROM base b
  ),
  -- Level 2: how many distinct channels within each source type?
  -- Gmail (no channel_id) → COUNT(DISTINCT NULL) = 0 → GREATEST(0,1) = 1
  channel_per_source AS (
    SELECT
      b.source_type                                            AS st,
      GREATEST(COUNT(DISTINCT b.metadata->>'channel_id'), 1)::int AS ch_cnt
    FROM base b
    GROUP BY b.source_type
  ),
  -- Rank within (source_type, channel) for channel-level diversity
  ranked AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        PARTITION BY b.source_type, b.metadata->>'channel_id'
        ORDER BY b.msg_ts DESC
      )                                                        AS rn_in_channel,
      stc.cnt                                                  AS source_count,
      cps.ch_cnt
    FROM base b
    CROSS JOIN source_type_count stc
    JOIN channel_per_source cps ON cps.st = b.source_type
  ),
  -- Keep at most (source_budget / channels_in_source) per channel
  channel_filtered AS (
    SELECT *
    FROM ranked
    WHERE rn_in_channel <= CEIL(
      (p_limit::float / source_count) / ch_cnt
    )::bigint
  ),
  -- Rank within source_type to enforce per-source budget
  source_ranked AS (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        PARTITION BY f.source_type
        ORDER BY f.msg_ts DESC
      )                                                        AS rn_in_source
    FROM channel_filtered f
  )
  SELECT
    sr.chunk_id, sr.document_id, sr.title, sr.chunk_text,
    sr.source_type, sr.metadata, sr.msg_ts
  FROM source_ranked sr
  WHERE sr.rn_in_source <= CEIL(p_limit::float / sr.source_count)::bigint
  ORDER BY sr.msg_ts ASC
  LIMIT p_limit;
END;
$$;

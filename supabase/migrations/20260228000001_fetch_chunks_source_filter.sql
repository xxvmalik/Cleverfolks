-- ============================================================
-- Add optional source_type filter to fetch_chunks_by_timerange
-- ============================================================
--
-- When p_source_types is NULL, all source types are returned
-- (existing behaviour — no breaking change).
-- When set (e.g. ARRAY['gmail_message']), only documents whose
-- source_type matches are included.
--
-- This lets the query planner issue email-only or Slack-only
-- broad fetches without a separate SQL function.
--
-- Gmail records have no channel_id, so they all land in one
-- partition under the diversity logic (channel_budget = p_limit)
-- and the full limit applies — correct behaviour.

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
  channel_count AS (
    SELECT GREATEST(COUNT(DISTINCT metadata->>'channel_id'), 1)::int AS cnt
    FROM base
  ),
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
  SELECT chunk_id, document_id, title, chunk_text, source_type, metadata, msg_ts
  FROM ranked
  WHERE rn <= CEIL(p_limit::float / channel_count)::bigint
  ORDER BY msg_ts ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================
-- Sprint 5 Fix 2: resolve "column reference metadata is ambiguous"
-- ============================================================
--
-- Root cause: in a PL/pgSQL function, every column listed in
-- RETURNS TABLE is implicitly declared as an in-scope variable.
-- So bare "metadata" inside a CTE was ambiguous between the CTE
-- column and the return-table variable.
--
-- Fix: switch to LANGUAGE sql (no PL/pgSQL variable scope, so
-- CTE column names are unambiguous) and qualify every reference.

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      dc.id                                           AS chunk_id,
      sd.id                                           AS document_id,
      sd.title,
      dc.chunk_text,
      sd.source_type,
      dc.metadata,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                               AS msg_ts
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
  -- Compute channel budget in a plain aggregate CTE to avoid
  -- the COUNT(DISTINCT) OVER () limitation in window functions.
  channel_count AS (
    SELECT GREATEST(COUNT(DISTINCT b.metadata->>'channel_id'), 1)::int AS cnt
    FROM base b
  ),
  ranked AS (
    SELECT
      b.chunk_id,
      b.document_id,
      b.title,
      b.chunk_text,
      b.source_type,
      b.metadata,
      b.msg_ts,
      ROW_NUMBER() OVER (
        PARTITION BY b.metadata->>'channel_id'
        ORDER BY b.msg_ts DESC
      )                                               AS rn,
      c.cnt                                           AS channel_count
    FROM base b
    CROSS JOIN channel_count c
  )
  SELECT
    r.chunk_id,
    r.document_id,
    r.title,
    r.chunk_text,
    r.source_type,
    r.metadata,
    r.msg_ts
  FROM ranked r
  WHERE r.rn <= CEIL(p_limit::float / r.channel_count)::bigint
  ORDER BY r.msg_ts ASC
  LIMIT p_limit;
$$;

-- ============================================================
-- Sprint 5: fetch_chunks_by_timerange
-- ============================================================
--
-- Used for broad summary queries ("what happened last week?",
-- "summarise this month's activity").  Instead of semantic/
-- keyword ranking, it returns ALL chunks whose message timestamp
-- falls within the requested window, ordered chronologically
-- (oldest → newest) so the LLM sees events in sequence.
--
-- Uses the same COALESCE timestamp logic as hybrid_search_documents:
--   prefer metadata->>'ts' (Slack unix epoch float) when present,
--   fall back to synced_documents.synced_at.

CREATE OR REPLACE FUNCTION fetch_chunks_by_timerange(
  p_workspace_id  uuid,
  p_after         timestamptz DEFAULT NULL,
  p_before        timestamptz DEFAULT NULL,
  p_limit         int         DEFAULT 50
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
  ORDER BY msg_ts ASC
  LIMIT p_limit;
END;
$$;

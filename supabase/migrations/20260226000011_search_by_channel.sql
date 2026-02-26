-- ============================================================
-- Sprint 4.5: search_by_channel
-- Fetch all chunks from a specific Slack channel (or any
-- source whose title contains the channel name).
-- ============================================================

CREATE OR REPLACE FUNCTION search_by_channel(
  p_workspace_id uuid,
  p_channel_name text,
  p_after        timestamptz DEFAULT NULL,
  p_before       timestamptz DEFAULT NULL,
  p_limit        int         DEFAULT 30
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
  SELECT
    dc.id                                                       AS chunk_id,
    sd.id                                                       AS document_id,
    sd.title,
    dc.chunk_text,
    sd.source_type,
    dc.metadata,
    COALESCE(
      CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
           THEN to_timestamp((dc.metadata->>'ts')::float)
      END,
      sd.synced_at
    )                                                           AS msg_ts
  FROM document_chunks dc
  JOIN synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND (
      dc.metadata->>'channel_name' ILIKE '%' || p_channel_name || '%'
      OR dc.metadata->>'channel_id' ILIKE '%' || p_channel_name || '%'
      OR sd.title                   ILIKE '%' || p_channel_name || '%'
    )
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
  ORDER BY COALESCE(
    CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
         THEN to_timestamp((dc.metadata->>'ts')::float)
    END,
    sd.synced_at
  ) DESC
  LIMIT p_limit;
$$;

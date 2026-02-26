-- ============================================================
-- Sprint 4 Fix: add channel diversity boost to hybrid search
-- ============================================================
--
-- After combining vector + keyword scores, determine the channel of the
-- top-scoring result, then apply a +0.05 bonus to any result from a
-- *different* channel.  This prevents 15 results all coming from the same
-- channel and surfaces messages from across the workspace.
--
-- Safety: if the top result has no channel_id, or a result has no channel_id,
-- no boost is applied (COALESCE / IS NOT NULL guards prevent false matches).

CREATE OR REPLACE FUNCTION hybrid_search_documents(
  p_workspace_id    uuid,
  p_query_embedding vector(1024),
  p_query_text      text,
  p_match_count     int         DEFAULT 10,
  p_match_threshold float       DEFAULT 0.5,
  p_after           timestamptz DEFAULT NULL,
  p_before          timestamptz DEFAULT NULL
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  chunk_text  text,
  source_type text,
  metadata    jsonb,
  similarity  float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH vector_search AS (
    SELECT
      dc.id                                    AS chunk_id,
      1 - (dc.embedding <=> p_query_embedding) AS score
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
  keyword_search AS (
    SELECT
      dc.id                                                              AS chunk_id,
      ts_rank(to_tsvector('english', dc.chunk_text),
              plainto_tsquery('english', p_query_text))                  AS score
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    WHERE dc.workspace_id = p_workspace_id
      AND to_tsvector('english', dc.chunk_text)
            @@ plainto_tsquery('english', p_query_text)
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
  combined AS (
    SELECT
      COALESCE(v.chunk_id, k.chunk_id)          AS chunk_id,
      COALESCE(v.score, 0.0) * 0.7
        + COALESCE(k.score, 0.0) * 0.3          AS base_score
    FROM vector_search v
    FULL OUTER JOIN keyword_search k ON k.chunk_id = v.chunk_id
  ),
  -- Identify the channel of the highest-scoring result for diversity boost
  top_channel AS (
    SELECT dc_top.metadata->>'channel_id' AS channel_id
    FROM combined c_top
    JOIN document_chunks dc_top ON dc_top.id = c_top.chunk_id
    ORDER BY c_top.base_score DESC
    LIMIT 1
  ),
  -- Apply +0.05 diversity bonus to results from channels other than the top
  scored AS (
    SELECT
      c.chunk_id,
      c.base_score + CASE
        WHEN (SELECT channel_id FROM top_channel) IS NOT NULL
          AND dc_s.metadata->>'channel_id' IS NOT NULL
          AND dc_s.metadata->>'channel_id'
              IS DISTINCT FROM (SELECT channel_id FROM top_channel)
        THEN 0.05
        ELSE 0.0
      END AS final_score
    FROM combined c
    JOIN document_chunks dc_s ON dc_s.id = c.chunk_id
  )
  SELECT
    s.chunk_id,
    sd.id                                       AS document_id,
    sd.title,
    dc.chunk_text,
    sd.source_type,
    dc.metadata,
    s.final_score                               AS similarity
  FROM scored s
  JOIN document_chunks dc ON dc.id = s.chunk_id
  JOIN synced_documents sd ON sd.id = dc.document_id
  WHERE s.final_score >= p_match_threshold
  ORDER BY s.final_score DESC
  LIMIT p_match_count;
END;
$$;

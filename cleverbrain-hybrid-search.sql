-- ============================================================
-- CleverBrain: Hybrid search function + GIN index
-- ============================================================

-- GIN index for full-text search on chunk_text
CREATE INDEX IF NOT EXISTS document_chunks_text_search_idx
  ON document_chunks USING gin(to_tsvector('english', chunk_text));

-- Hybrid search: combines vector cosine similarity (0.7) + keyword ranking (0.3)
-- Time filter uses the actual message timestamp (metadata->>'ts' as Slack unix
-- epoch float) rather than synced_at, so "last week" queries correctly match
-- messages sent last week regardless of when the data was imported.
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
        + COALESCE(k.score, 0.0) * 0.3          AS combined_score
    FROM vector_search v
    FULL OUTER JOIN keyword_search k ON k.chunk_id = v.chunk_id
  )
  SELECT
    c.chunk_id,
    sd.id                                       AS document_id,
    sd.title,
    dc.chunk_text,
    sd.source_type,
    dc.metadata,
    c.combined_score                            AS similarity
  FROM combined c
  JOIN document_chunks dc ON dc.id = c.chunk_id
  JOIN synced_documents sd ON sd.id = dc.document_id
  WHERE c.combined_score >= p_match_threshold
  ORDER BY c.combined_score DESC
  LIMIT p_match_count;
END;
$$;

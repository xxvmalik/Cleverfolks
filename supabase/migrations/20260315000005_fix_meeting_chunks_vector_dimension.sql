-- Fix meeting_chunks embedding dimension: 1536 → 1024 (Voyage AI uses 1024)
-- Also add the semantic search RPC function for meeting chunks

ALTER TABLE meeting_chunks
  ALTER COLUMN embedding TYPE vector(1024);

-- Drop and recreate the HNSW index with correct dimension
DROP INDEX IF EXISTS idx_meeting_chunks_embedding;
CREATE INDEX idx_meeting_chunks_embedding
  ON meeting_chunks USING hnsw (embedding vector_cosine_ops);

-- Semantic search function for meeting transcript chunks
CREATE OR REPLACE FUNCTION search_meeting_chunks(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_query_embedding vector(1024),
  p_match_count int DEFAULT 5,
  p_min_similarity float DEFAULT 0.5
)
RETURNS TABLE (
  id uuid,
  transcript_id uuid,
  speaker_name text,
  chunk_text text,
  start_time float,
  end_time float,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    mc.id,
    mc.transcript_id,
    mc.speaker_name,
    mc.chunk_text,
    mc.start_time,
    mc.end_time,
    1 - (mc.embedding <=> p_query_embedding) AS similarity
  FROM meeting_chunks mc
  WHERE mc.workspace_id = p_workspace_id
    AND mc.lead_id = p_lead_id
    AND 1 - (mc.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY mc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

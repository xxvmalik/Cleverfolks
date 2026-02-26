-- ============================================================
-- Sprint 4 Fix: correct time filtering + resolve Slack IDs
-- ============================================================

-- ── Part A: Resolve Slack IDs in existing synced_documents ───────────────────
--
-- Build lookup maps from the SlackChannel and SlackUser records that were
-- already synced (stored as source_type = 'document').
-- Then update slack_message, slack_reply, slack_reaction records to add
-- channel_name and user_name into their metadata, and fix the title field.
-- Uses scalar subqueries to avoid PostgreSQL's restriction on referencing
-- the target table alias inside FROM-clause JOIN conditions.

UPDATE synced_documents sd
SET
  title = CASE
    WHEN sd.source_type = 'slack_message' THEN
      'Slack message in #' || COALESCE(
        (SELECT cl.metadata->>'name'
         FROM synced_documents cl
         WHERE cl.source_type = 'document'
           AND cl.metadata->>'channel_id' = sd.metadata->>'channel_id'
         LIMIT 1),
        sd.metadata->>'channel_id'
      )
    WHEN sd.source_type = 'slack_reply' THEN
      'Reply in #' || COALESCE(
        (SELECT cl.metadata->>'name'
         FROM synced_documents cl
         WHERE cl.source_type = 'document'
           AND cl.metadata->>'channel_id' = sd.metadata->>'channel_id'
         LIMIT 1),
        sd.metadata->>'channel_id'
      )
    WHEN sd.source_type = 'slack_reaction' THEN
      'Reaction in #' || COALESCE(
        (SELECT cl.metadata->>'name'
         FROM synced_documents cl
         WHERE cl.source_type = 'document'
           AND cl.metadata->>'channel_id' = sd.metadata->>'channel_id'
         LIMIT 1),
        sd.metadata->>'channel_id'
      )
    ELSE sd.title
  END,
  metadata = sd.metadata
    || COALESCE(
        (SELECT jsonb_build_object('channel_name', cl.metadata->>'name')
         FROM synced_documents cl
         WHERE cl.source_type = 'document'
           AND cl.metadata->>'channel_id' = sd.metadata->>'channel_id'
         LIMIT 1),
        '{}'::jsonb
      )
    || COALESCE(
        (SELECT jsonb_build_object('user_name', ul.title)
         FROM synced_documents ul
         WHERE ul.source_type = 'document'
           AND ul.metadata->>'user_id' = sd.metadata->>'user'
         LIMIT 1),
        '{}'::jsonb
      )
WHERE sd.source_type IN ('slack_message', 'slack_reply', 'slack_reaction');

-- ── Update document_chunks with the same resolved names ──────────────────────

UPDATE document_chunks dc
SET metadata = dc.metadata
    || COALESCE(
        (SELECT jsonb_build_object('channel_name', cl.metadata->>'name')
         FROM synced_documents cl
         WHERE cl.source_type = 'document'
           AND cl.metadata->>'channel_id' = dc.metadata->>'channel_id'
         LIMIT 1),
        '{}'::jsonb
      )
    || COALESCE(
        (SELECT jsonb_build_object('user_name', ul.title)
         FROM synced_documents ul
         WHERE ul.source_type = 'document'
           AND ul.metadata->>'user_id' = dc.metadata->>'user'
         LIMIT 1),
        '{}'::jsonb
      )
WHERE dc.metadata->>'source_type' IN ('slack_message', 'slack_reply', 'slack_reaction');


-- ── Part B: Fix hybrid_search_documents — use actual message timestamp ────────
--
-- Previously the time filter compared against synced_at (the import date).
-- Now we use the Slack unix epoch stored in metadata->>'ts' when present,
-- falling back to synced_at for non-Slack source types.
-- Safe cast: only coerce to float when the value looks like a plain number.

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

-- ============================================================
-- Sprint 4.5: fetch_surrounding_chunks
-- Returns p_window messages before and after a target chunk
-- from the same Slack channel, ordered by timestamp ASC.
-- ============================================================

CREATE OR REPLACE FUNCTION fetch_surrounding_chunks(
  p_chunk_id     uuid,
  p_workspace_id uuid,
  p_window       int DEFAULT 3
)
RETURNS TABLE (
  chunk_id    uuid,
  chunk_text  text,
  source_type text,
  metadata    jsonb,
  msg_ts      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Step 1: resolve the target chunk's channel and timestamp
  WITH target AS (
    SELECT
      dc.metadata->>'channel_id'                               AS channel_id,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                        AS ts
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    WHERE dc.id = p_chunk_id
      AND dc.workspace_id = p_workspace_id
  ),
  -- Step 2: p_window messages immediately before the target (nearest first → DESC)
  before_chunks AS (
    SELECT
      dc.id                                                    AS chunk_id,
      dc.chunk_text,
      sd.source_type,
      dc.metadata,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                        AS msg_ts
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    CROSS JOIN target t
    WHERE dc.workspace_id = p_workspace_id
      AND dc.metadata->>'channel_id' = t.channel_id
      AND COALESCE(
            CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                 THEN to_timestamp((dc.metadata->>'ts')::float)
            END,
            sd.synced_at
          ) < t.ts
    ORDER BY msg_ts DESC
    LIMIT p_window
  ),
  -- Step 3: p_window messages immediately after the target (earliest first → ASC)
  after_chunks AS (
    SELECT
      dc.id                                                    AS chunk_id,
      dc.chunk_text,
      sd.source_type,
      dc.metadata,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                        AS msg_ts
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    CROSS JOIN target t
    WHERE dc.workspace_id = p_workspace_id
      AND dc.metadata->>'channel_id' = t.channel_id
      AND COALESCE(
            CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
                 THEN to_timestamp((dc.metadata->>'ts')::float)
            END,
            sd.synced_at
          ) > t.ts
    ORDER BY msg_ts ASC
    LIMIT p_window
  ),
  -- Step 4: the target chunk itself
  target_chunk AS (
    SELECT
      dc.id                                                    AS chunk_id,
      dc.chunk_text,
      sd.source_type,
      dc.metadata,
      COALESCE(
        CASE WHEN dc.metadata->>'ts' ~ '^[0-9]+\.?[0-9]*$'
             THEN to_timestamp((dc.metadata->>'ts')::float)
        END,
        sd.synced_at
      )                                                        AS msg_ts
    FROM document_chunks dc
    JOIN synced_documents sd ON sd.id = dc.document_id
    WHERE dc.id = p_chunk_id
      AND dc.workspace_id = p_workspace_id
  )
  SELECT bc.chunk_id, bc.chunk_text, bc.source_type, bc.metadata, bc.msg_ts
    FROM before_chunks bc
  UNION ALL
  SELECT tc.chunk_id, tc.chunk_text, tc.source_type, tc.metadata, tc.msg_ts
    FROM target_chunk tc
  UNION ALL
  SELECT ac.chunk_id, ac.chunk_text, ac.source_type, ac.metadata, ac.msg_ts
    FROM after_chunks ac
  ORDER BY msg_ts ASC;
$$;

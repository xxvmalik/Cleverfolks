-- ============================================================
-- Add gmail_message support to hybrid aggregation functions
-- ============================================================
--
-- aggregate_by_person_keyword_others now counts gmail_message
-- records in addition to slack_message / slack_reply, so email
-- activity is included when users ask "who mentioned X most?"
--
-- aggregate_by_person_in_channels remains Slack-only (uses
-- channel_name metadata which Gmail messages do not have).
-- ============================================================

CREATE OR REPLACE FUNCTION aggregate_by_person_keyword_others(
  p_workspace_id     uuid,
  p_keywords         text[],
  p_exclude_channels text[]      DEFAULT NULL,
  p_after            timestamptz DEFAULT NULL,
  p_before           timestamptz DEFAULT NULL,
  p_limit            int         DEFAULT 100
)
RETURNS TABLE (
  user_name     text,
  message_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') AS user_name,
    COUNT(DISTINCT dc.document_id)                            AS message_count
  FROM  document_chunks dc
  JOIN  synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND sd.source_type   IN ('slack_message', 'slack_reply', 'gmail_message')
    -- Exclude bots and anonymous senders
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') IS NOT NULL
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
    -- Exclude dedicated channels (already counted separately via aggregate_by_person_in_channels)
    -- Gmail messages have no channel_name so they are never excluded here
    AND (p_exclude_channels IS NULL
         OR dc.metadata->>'channel_name' != ALL(p_exclude_channels))
    -- Must match at least one keyword
    AND EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE dc.chunk_text ILIKE '%' || kw || '%'
    )
    -- Optional time range
    AND (p_after IS NULL OR
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
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

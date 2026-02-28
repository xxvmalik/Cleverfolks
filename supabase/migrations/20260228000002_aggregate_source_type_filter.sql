-- ============================================================
-- Make hybrid aggregation functions source-type agnostic
-- ============================================================
--
-- Both aggregate functions previously hard-coded their source_type
-- IN (...) filter, which required SQL changes whenever a new
-- integration was added.
--
-- After this migration:
--   p_source_types text[] DEFAULT NULL
--
-- NULL (the default) = count across ALL source types.
-- Passing a value (e.g. ARRAY['gmail_message']) scopes the count
-- to that integration's data only.
--
-- Examples:
--   "Who communicated the most?"         → NULL (all types)
--   "Who emailed the most?"              → ARRAY['gmail_message']
--   "Most active in Slack this week?"    → ARRAY['slack_message','slack_reply']
--
-- No behaviour change for existing callers that don't pass the new param.

-- ── aggregate_by_person_in_channels ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION aggregate_by_person_in_channels(
  p_workspace_id  uuid,
  p_channels      text[],
  p_after         timestamptz  DEFAULT NULL,
  p_before        timestamptz  DEFAULT NULL,
  p_limit         int          DEFAULT 100,
  p_source_types  text[]       DEFAULT NULL
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
    -- Source-type filter: NULL = all types
    AND (p_source_types IS NULL OR sd.source_type = ANY(p_source_types))
    -- Exclude bots and anonymous senders
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') IS NOT NULL
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
    -- Must be in one of the dedicated channels
    AND dc.metadata->>'channel_name' = ANY(p_channels)
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

-- ── aggregate_by_person_keyword_others ────────────────────────────────────────

CREATE OR REPLACE FUNCTION aggregate_by_person_keyword_others(
  p_workspace_id     uuid,
  p_keywords         text[],
  p_exclude_channels text[]      DEFAULT NULL,
  p_after            timestamptz DEFAULT NULL,
  p_before           timestamptz DEFAULT NULL,
  p_limit            int         DEFAULT 100,
  p_source_types     text[]      DEFAULT NULL
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
    -- Source-type filter: NULL = all types
    AND (p_source_types IS NULL OR sd.source_type = ANY(p_source_types))
    -- Exclude bots and anonymous senders
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') IS NOT NULL
    AND COALESCE(dc.metadata->>'user_name', dc.metadata->>'user') NOT ILIKE '%bot%'
    -- Exclude dedicated channels (already counted separately)
    -- Gmail/email records have no channel_name so they are never excluded
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

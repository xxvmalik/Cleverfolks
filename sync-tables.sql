-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- synced_documents table
-- ============================================================
CREATE TABLE IF NOT EXISTS synced_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  source_type    text NOT NULL CHECK (source_type IN ('email', 'gmail_message', 'gmail_contact', 'slack_message', 'slack_reply', 'slack_reaction', 'calendar_event', 'deal', 'document', 'attachment')),
  external_id    text NOT NULL,
  title          text,
  content        text,
  metadata       jsonb DEFAULT '{}',
  synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, integration_id, external_id)
);

ALTER TABLE synced_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_select_synced_documents"
  ON synced_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships
      WHERE workspace_memberships.workspace_id = synced_documents.workspace_id
        AND workspace_memberships.user_id = auth.uid()
    )
  );

-- ============================================================
-- document_chunks table
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES synced_documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_text  text NOT NULL,
  chunk_index integer NOT NULL,
  embedding   vector(1024),
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_select_document_chunks"
  ON document_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships
      WHERE workspace_memberships.workspace_id = document_chunks.workspace_id
        AND workspace_memberships.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- SECURITY DEFINER functions
-- ============================================================

-- 1. Upsert a synced document, return its id
CREATE OR REPLACE FUNCTION upsert_synced_document(
  p_workspace_id   uuid,
  p_integration_id uuid,
  p_source_type    text,
  p_external_id    text,
  p_title          text,
  p_content        text,
  p_metadata       jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO synced_documents (workspace_id, integration_id, source_type, external_id, title, content, metadata, synced_at)
  VALUES (p_workspace_id, p_integration_id, p_source_type, p_external_id, p_title, p_content, p_metadata, now())
  ON CONFLICT (workspace_id, integration_id, external_id)
  DO UPDATE SET
    title     = EXCLUDED.title,
    content   = EXCLUDED.content,
    metadata  = EXCLUDED.metadata,
    synced_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 2. Create a document chunk
CREATE OR REPLACE FUNCTION create_document_chunk(
  p_document_id  uuid,
  p_workspace_id uuid,
  p_chunk_text   text,
  p_chunk_index  integer,
  p_embedding    vector(1024),
  p_metadata     jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO document_chunks (document_id, workspace_id, chunk_text, chunk_index, embedding, metadata)
  VALUES (p_document_id, p_workspace_id, p_chunk_text, p_chunk_index, p_embedding, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 3. Search documents by cosine similarity
CREATE OR REPLACE FUNCTION search_documents(
  p_workspace_id     uuid,
  p_query_embedding  vector(1024),
  p_match_count      int     DEFAULT 5,
  p_match_threshold  float   DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  chunk_text  text,
  source_type text,
  similarity  float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id                                      AS chunk_id,
    sd.id                                      AS document_id,
    sd.title,
    dc.chunk_text,
    sd.source_type,
    1 - (dc.embedding <=> p_query_embedding)   AS similarity
  FROM document_chunks dc
  JOIN synced_documents sd ON sd.id = dc.document_id
  WHERE dc.workspace_id = p_workspace_id
    AND 1 - (dc.embedding <=> p_query_embedding) >= p_match_threshold
  ORDER BY similarity DESC
  LIMIT p_match_count;
END;
$$;

-- 4. Delete all chunks for a document
CREATE OR REPLACE FUNCTION delete_chunks_for_document(
  p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM document_chunks WHERE document_id = p_document_id;
END;
$$;

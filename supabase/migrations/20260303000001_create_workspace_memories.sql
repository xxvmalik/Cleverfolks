-- Workspace memories table: shared brain for all AI agents
CREATE TABLE IF NOT EXISTS workspace_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID DEFAULT NULL,  -- NULL = workspace-wide, set = user-specific
  agent_id TEXT DEFAULT NULL,  -- which agent learned this (cleverbrain, skyler, etc)
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'user', 'agent')),
  type TEXT NOT NULL CHECK (type IN ('correction', 'preference', 'terminology', 'pattern', 'learning')),
  content TEXT NOT NULL,  -- the actual memory: "8115 is a service ID not order ID"
  embedding vector(1024),  -- Voyage AI embedding for semantic search
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  source_conversation_id UUID DEFAULT NULL,  -- which conversation taught us this
  times_reinforced INTEGER NOT NULL DEFAULT 1,  -- how many times confirmed
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  superseded_by UUID DEFAULT NULL REFERENCES workspace_memories(id)
);

-- Indexes for fast retrieval
CREATE INDEX idx_workspace_memories_workspace ON workspace_memories(workspace_id);
CREATE INDEX idx_workspace_memories_scope ON workspace_memories(workspace_id, scope);
CREATE INDEX idx_workspace_memories_type ON workspace_memories(workspace_id, type);
CREATE INDEX idx_workspace_memories_active ON workspace_memories(workspace_id) WHERE superseded_by IS NULL;

-- HNSW index for vector similarity search
CREATE INDEX idx_workspace_memories_embedding ON workspace_memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RPC function: search memories by semantic similarity
CREATE OR REPLACE FUNCTION search_workspace_memories(
  p_workspace_id UUID,
  p_query_embedding vector(1024),
  p_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  scope TEXT,
  type TEXT,
  content TEXT,
  confidence TEXT,
  times_reinforced INTEGER,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    wm.id,
    wm.scope,
    wm.type,
    wm.content,
    wm.confidence,
    wm.times_reinforced,
    wm.last_used_at,
    wm.created_at,
    1 - (wm.embedding <=> p_query_embedding) AS similarity
  FROM workspace_memories wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.superseded_by IS NULL  -- only active memories
    AND (
      wm.scope = 'workspace'  -- always include workspace memories
      OR (wm.scope = 'user' AND wm.user_id = p_user_id)  -- include user's personal memories
      OR wm.scope = 'agent'  -- always include agent learnings
    )
  ORDER BY
    -- Weighted ranking: similarity * reinforcement * recency
    (1 - (wm.embedding <=> p_query_embedding))
    * (1 + LN(GREATEST(wm.times_reinforced, 1)))
    * (1.0 / (1 + EXTRACT(EPOCH FROM (NOW() - wm.last_used_at)) / 86400 / 30))  -- decay over 30 days
    DESC
  LIMIT p_limit;
$$;

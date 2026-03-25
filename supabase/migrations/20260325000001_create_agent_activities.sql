-- Phase 2B: Agent Activities table — cross-agent activity feed
-- Every significant agent action writes here for visibility and CleverBrain querying.

CREATE TABLE IF NOT EXISTS agent_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL DEFAULT 'skyler',
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  related_entity_id UUID,
  related_entity_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_agent_activities_workspace ON agent_activities(workspace_id, created_at DESC);
CREATE INDEX idx_agent_activities_type ON agent_activities(workspace_id, activity_type, created_at DESC);
CREATE INDEX idx_agent_activities_agent ON agent_activities(workspace_id, agent_type, created_at DESC);
CREATE INDEX idx_agent_activities_entity ON agent_activities(related_entity_id) WHERE related_entity_id IS NOT NULL;

-- RLS
ALTER TABLE agent_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can view agent activities"
  ON agent_activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = agent_activities.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

-- Service role can insert (Inngest background jobs use service role)
CREATE POLICY "service role can insert agent activities"
  ON agent_activities FOR INSERT
  WITH CHECK (true);

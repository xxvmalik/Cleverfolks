-- Skyler Actions table — tracks all write actions (pending, executed, failed, rejected)
CREATE TABLE IF NOT EXISTS skyler_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_input JSONB NOT NULL DEFAULT '{}',
  nango_connection_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'rejected')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_skyler_actions_workspace_status
  ON skyler_actions(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_skyler_actions_conversation
  ON skyler_actions(conversation_id);

-- RLS policies
ALTER TABLE skyler_actions ENABLE ROW LEVEL SECURITY;

-- Members of the workspace can view actions
CREATE POLICY skyler_actions_select ON skyler_actions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_actions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Members can insert actions (via API)
CREATE POLICY skyler_actions_insert ON skyler_actions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_actions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Members can update their workspace's actions (approve/reject)
CREATE POLICY skyler_actions_update ON skyler_actions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_actions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Audit log for Skyler's AI reasoning engine decisions.
-- Every decision the reasoning engine makes is logged here for transparency and debugging.

CREATE TABLE IF NOT EXISTS skyler_decisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  decision JSONB NOT NULL,
  guardrail_outcome TEXT NOT NULL,
  guardrail_reason TEXT,
  execution_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for querying decisions by pipeline (lead card history)
CREATE INDEX idx_skyler_decisions_pipeline ON skyler_decisions(pipeline_id, created_at DESC);

-- Index for querying decisions by workspace (admin dashboard)
CREATE INDEX idx_skyler_decisions_workspace ON skyler_decisions(workspace_id, created_at DESC);

-- RLS
ALTER TABLE skyler_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view decisions in their workspace"
  ON skyler_decisions FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()
    )
  );

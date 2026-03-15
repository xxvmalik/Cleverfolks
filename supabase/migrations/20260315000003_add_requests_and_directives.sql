-- Stage 8: Request Loop + User Directives
-- Two new tables for Skyler's request loop and per-lead directives.

-- ── Requests: When Skyler asks a human for information ──────────────────────

CREATE TABLE IF NOT EXISTS skyler_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  request_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'expired')),
  response_content TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX idx_skyler_requests_pipeline ON skyler_requests(pipeline_id);
CREATE INDEX idx_skyler_requests_pending ON skyler_requests(workspace_id, status) WHERE status = 'pending';

ALTER TABLE skyler_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage requests"
  ON skyler_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_requests.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── Directives: Per-lead instructions from users ────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_directives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  directive_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_skyler_directives_pipeline ON skyler_directives(pipeline_id);
CREATE INDEX idx_skyler_directives_active ON skyler_directives(pipeline_id, is_active) WHERE is_active = true;

ALTER TABLE skyler_directives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage directives"
  ON skyler_directives FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_directives.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

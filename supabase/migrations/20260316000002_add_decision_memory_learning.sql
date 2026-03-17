-- Stage 11: Decision Memory & Learning System
-- Adds tables for corrections, golden examples, behavioural dimensions,
-- confidence tracking, and new columns on skyler_decisions.

-- ── New columns on skyler_decisions ──────────────────────────────────────────

ALTER TABLE skyler_decisions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS edit_distance FLOAT,
  ADD COLUMN IF NOT EXISTS approval_speed_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS action_id UUID;

-- ── agent_corrections ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE SET NULL,
  correction_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'lead_specific',
  original_action JSONB,
  correction_text TEXT NOT NULL,
  clarification_text TEXT,
  derived_rule TEXT,
  context_embedding vector(1024),
  context_metadata JSONB,
  source TEXT NOT NULL,
  source_decision_id UUID REFERENCES skyler_decisions(id) ON DELETE SET NULL,
  confidence FLOAT DEFAULT 1.0,
  is_active BOOLEAN DEFAULT TRUE,
  superseded_by UUID REFERENCES agent_corrections(id),
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_corrections_workspace ON agent_corrections(workspace_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_corrections_type ON agent_corrections(workspace_id, correction_type, is_active) WHERE is_active = TRUE;

-- ── golden_examples ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS golden_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE SET NULL,
  decision_id UUID REFERENCES skyler_decisions(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  input_context JSONB NOT NULL,
  agent_output JSONB NOT NULL,
  composite_score FLOAT DEFAULT 0.0,
  approval_speed_seconds INTEGER,
  edit_distance FLOAT,
  outcome_score FLOAT,
  context_embedding vector(1024),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0
);

CREATE INDEX idx_golden_workspace ON golden_examples(workspace_id, is_active, task_type) WHERE is_active = TRUE;

-- ── behavioural_dimensions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS behavioural_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  score FLOAT NOT NULL DEFAULT 0.0,
  context_scope TEXT DEFAULT 'global',
  context_criteria JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, dimension, context_scope, COALESCE(context_criteria::text, '{}'))
);

CREATE INDEX idx_behavioural_workspace ON behavioural_dimensions(workspace_id);

-- ── confidence_tracking ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS confidence_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  alpha FLOAT DEFAULT 1.0,
  beta FLOAT DEFAULT 1.0,
  ewma FLOAT DEFAULT 0.5,
  total_decisions INTEGER DEFAULT 0,
  autonomy_level TEXT DEFAULT 'blocked',
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, task_type)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE agent_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE golden_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavioural_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view corrections in their workspace"
  ON agent_corrections FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "Users can view golden examples in their workspace"
  ON golden_examples FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "Users can view behavioural dimensions in their workspace"
  ON behavioural_dimensions FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "Users can view confidence tracking in their workspace"
  ON confidence_tracking FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_memberships WHERE user_id = auth.uid()));

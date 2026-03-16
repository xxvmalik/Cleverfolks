-- Stage 10: Knowledge Gap Detection & Permanent Memory
-- 1. Add agent_memories table for permanent fact storage
-- 2. Update skyler_notifications event_type constraint to include new types

-- ── agent_memories table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID, -- NULL = workspace-level fact, non-NULL = lead-specific override
  fact_key TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('payment', 'company', 'legal', 'preference', 'contact', 'product', 'pricing', 'technical')),
  source TEXT NOT NULL DEFAULT 'user_provided' CHECK (source IN ('user_provided', 'onboarding', 'inferred', 'system')),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by UUID REFERENCES agent_memories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active facts for a workspace (most common query)
CREATE INDEX idx_agent_memories_workspace
  ON agent_memories(workspace_id, is_current)
  WHERE is_current = TRUE;

-- Active facts for a specific lead within a workspace
CREATE INDEX idx_agent_memories_lead
  ON agent_memories(workspace_id, lead_id, is_current)
  WHERE is_current = TRUE;

-- Unique key per workspace+lead+fact_key (only among current facts)
-- COALESCE handles NULL lead_id so workspace-level and lead-level facts
-- don't collide on the unique index
CREATE UNIQUE INDEX idx_agent_memories_unique_key
  ON agent_memories(workspace_id, COALESCE(lead_id, '00000000-0000-0000-0000-000000000000'::UUID), fact_key)
  WHERE is_current = TRUE;

-- ── Update skyler_notifications event_type constraint ────────────────────────

ALTER TABLE skyler_notifications
  DROP CONSTRAINT IF EXISTS skyler_notifications_event_type_check;

ALTER TABLE skyler_notifications
  ADD CONSTRAINT skyler_notifications_event_type_check
  CHECK (event_type IN (
    'lead_replied',
    'draft_awaiting_approval',
    'lead_scored_hot',
    'escalation_triggered',
    'deal_closed_won',
    'deal_closed_lost',
    'objection_received',
    'meeting_booked',
    'action_note_due',
    'info_requested'
  ));

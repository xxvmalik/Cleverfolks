-- ============================================================
-- Add agent_type column to conversations table
-- Distinguishes Skyler conversations from CleverBrain conversations
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agent_type text NOT NULL DEFAULT 'cleverbrain'
  CHECK (agent_type IN ('cleverbrain', 'skyler'));

CREATE INDEX IF NOT EXISTS idx_conversations_agent_type
  ON public.conversations (workspace_id, user_id, agent_type);

-- ============================================================
-- Update create_conversation to accept agent_type
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_conversation(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_title        text DEFAULT 'New conversation',
  p_agent_type   text DEFAULT 'cleverbrain'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO conversations (workspace_id, user_id, title, agent_type)
  VALUES (p_workspace_id, p_user_id, p_title, p_agent_type)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- Update get_workspace_conversations to filter by agent_type
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_workspace_conversations(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_agent_type   text DEFAULT 'cleverbrain'
)
RETURNS TABLE (
  id           uuid,
  workspace_id uuid,
  user_id      uuid,
  title        text,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.workspace_id, c.user_id, c.title, c.created_at, c.updated_at
  FROM conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.user_id = p_user_id
    AND c.agent_type = p_agent_type
  ORDER BY c.updated_at DESC;
END;
$$;

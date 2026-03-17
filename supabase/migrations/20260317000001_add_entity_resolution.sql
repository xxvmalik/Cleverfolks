-- Stage 12: Entity Resolution & Context Isolation
-- Adds entity tracking to conversations and messages.

-- Add entity tracking to conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS active_entity_id UUID,
  ADD COLUMN IF NOT EXISTS active_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS active_entity_name TEXT,
  ADD COLUMN IF NOT EXISTS entity_focus_stack JSONB DEFAULT '[]';

-- Add entity tracking to individual messages
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS active_entity_id UUID;

-- Index for filtering messages by entity within a conversation
CREATE INDEX IF NOT EXISTS idx_chat_messages_entity
  ON chat_messages(conversation_id, active_entity_id)
  WHERE active_entity_id IS NOT NULL;

-- Update create_chat_message to accept optional entity ID
CREATE OR REPLACE FUNCTION public.create_chat_message(
  p_conversation_id uuid,
  p_role            text,
  p_content         text,
  p_sources         jsonb DEFAULT NULL,
  p_active_entity_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO chat_messages (conversation_id, role, content, sources, active_entity_id)
  VALUES (p_conversation_id, p_role, p_content, p_sources, p_active_entity_id)
  RETURNING id INTO v_id;

  UPDATE conversations SET updated_at = now() WHERE id = p_conversation_id;

  RETURN v_id;
END;
$$;

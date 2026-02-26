-- ============================================================
-- CleverBrain: conversations + chat_messages tables
-- ============================================================

-- ============================================================
-- conversations table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  title        text        NOT NULL DEFAULT 'New conversation',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations: members can select own"
  ON public.conversations FOR SELECT
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

CREATE POLICY "conversations: members can insert own"
  ON public.conversations FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

CREATE POLICY "conversations: members can update own"
  ON public.conversations FOR UPDATE
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_conversations_workspace_user
  ON public.conversations (workspace_id, user_id);

-- ============================================================
-- chat_messages table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  sources         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages: users can select own conversation messages"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = chat_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "chat_messages: users can insert into own conversations"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = chat_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

CREATE INDEX idx_chat_messages_conversation_id
  ON public.chat_messages (conversation_id);

-- ============================================================
-- SECURITY DEFINER functions
-- ============================================================

-- 1. Create a conversation, return its id
CREATE OR REPLACE FUNCTION public.create_conversation(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_title        text DEFAULT 'New conversation'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO conversations (workspace_id, user_id, title)
  VALUES (p_workspace_id, p_user_id, p_title)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 2. Get all conversations for a user in a workspace
CREATE OR REPLACE FUNCTION public.get_workspace_conversations(
  p_workspace_id uuid,
  p_user_id      uuid
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
  ORDER BY c.updated_at DESC;
END;
$$;

-- 3. Create a chat message, return its id
CREATE OR REPLACE FUNCTION public.create_chat_message(
  p_conversation_id uuid,
  p_role            text,
  p_content         text,
  p_sources         jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO chat_messages (conversation_id, role, content, sources)
  VALUES (p_conversation_id, p_role, p_content, p_sources)
  RETURNING id INTO v_id;

  -- Bump the parent conversation's updated_at
  UPDATE conversations SET updated_at = now()
  WHERE id = p_conversation_id;

  RETURN v_id;
END;
$$;

-- 4. Get all messages for a conversation
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
  p_conversation_id uuid
)
RETURNS TABLE (
  id              uuid,
  conversation_id uuid,
  role            text,
  content         text,
  sources         jsonb,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.conversation_id, m.role, m.content, m.sources, m.created_at
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
  ORDER BY m.created_at ASC;
END;
$$;

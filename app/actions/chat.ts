"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function getConversationsAction(workspaceId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { conversations: [], error: "Unauthorized" };

  const { data, error } = await supabase.rpc("get_workspace_conversations", {
    p_workspace_id: workspaceId,
    p_user_id: user.id,
    p_agent_type: "cleverbrain",
  });

  return {
    conversations: (data ?? []) as ConversationRow[],
    error: error?.message ?? null,
  };
}

export async function getMessagesAction(conversationId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { messages: [], error: "Unauthorized" };

  const { data, error } = await supabase.rpc("get_conversation_messages", {
    p_conversation_id: conversationId,
  });

  return {
    messages: (data ?? []) as MessageRow[],
    error: error?.message ?? null,
  };
}

// ── Shared row types (used by both actions and client) ────────────────────────
export type ConversationRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sources: any | null;
  created_at: string;
};

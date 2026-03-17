/**
 * Entity-Scoped History Filter (Stage 12, Part C).
 *
 * When the active entity switches, filters conversation history to prevent
 * cross-lead contamination. Each message is tagged with the entity it was
 * about, and only relevant messages are sent to Claude.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  active_entity_id?: string | null;
};

/**
 * Filter conversation history based on entity context.
 *
 * If the entity changed from the previous message:
 * - Include a transition marker
 * - Filter history to only include turns about the current entity
 * - Keep 1-2 turns from the previous entity as reference
 *
 * If the entity is the same: return history unmodified.
 */
export function filterHistoryByEntity(
  history: HistoryMessage[],
  activeEntityId: string | null,
  activeEntityName: string | null,
  previousEntityId: string | null,
  previousEntityName: string | null
): Array<{ role: "user" | "assistant"; content: string }> {
  // No entity resolved — return history as-is
  if (!activeEntityId) return history;

  // Same entity — no filtering needed
  if (activeEntityId === previousEntityId) return history;

  // Entity changed! Filter history.
  const currentEntityMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const previousEntityMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of history) {
    if (msg.active_entity_id === activeEntityId) {
      currentEntityMessages.push({ role: msg.role, content: msg.content });
    } else if (msg.active_entity_id === previousEntityId && previousEntityId) {
      previousEntityMessages.push({ role: msg.role, content: msg.content });
    }
    // Messages about other entities or without entity tags are dropped
  }

  const filtered: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Include 1-2 turns from previous entity for context continuity (marked)
  if (previousEntityMessages.length > 0 && previousEntityName) {
    const lastPrev = previousEntityMessages.slice(-2);
    filtered.push({
      role: "user" as const,
      content: `[Previous context about ${previousEntityName} — for reference only, do NOT target actions here]\n${lastPrev.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
    });
    filtered.push({
      role: "assistant" as const,
      content: "Understood, I have that for reference.",
    });
  }

  // Add transition marker
  filtered.push({
    role: "user" as const,
    content: `[Context switch: now working with ${activeEntityName ?? "a different lead"}]`,
  });
  filtered.push({
    role: "assistant" as const,
    content: `Got it, I'm now focused on ${activeEntityName ?? "the new lead"}. All my responses and actions will be about them.`,
  });

  // Include all turns about the current entity
  filtered.push(...currentEntityMessages);

  return filtered;
}

/**
 * Load messages with entity IDs for a conversation.
 * This is used instead of the basic get_conversation_messages RPC
 * when entity filtering is needed.
 */
export async function loadEntityScopedHistory(
  db: SupabaseClient,
  conversationId: string,
  limit = 30
): Promise<HistoryMessage[]> {
  const { data: msgs } = await db
    .from("chat_messages")
    .select("role, content, active_entity_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!msgs) return [];

  return (msgs as Array<{ role: string; content: string; active_entity_id: string | null }>).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    active_entity_id: m.active_entity_id,
  }));
}

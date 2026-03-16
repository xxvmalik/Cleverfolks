/**
 * Agent Memory Store — permanent fact storage for Skyler.
 *
 * Stores business facts (payment details, legal info, preferences, etc.)
 * with workspace + optional lead scoping. Old facts are superseded (not
 * deleted) when updated, preserving full audit history.
 *
 * Workspace-level facts (lead_id = NULL) apply to all leads.
 * Lead-level facts override workspace defaults for that specific lead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentMemoryCategory =
  | "payment"
  | "company"
  | "legal"
  | "preference"
  | "contact"
  | "product"
  | "pricing"
  | "technical";

export type AgentMemorySource =
  | "user_provided"
  | "onboarding"
  | "inferred"
  | "system";

export type AgentMemory = {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  fact_key: string;
  fact_value: unknown;
  category: AgentMemoryCategory;
  source: AgentMemorySource;
  is_current: boolean;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get all current facts for a workspace, optionally overlaid with lead-specific facts.
 * Lead-level facts override workspace-level facts with the same key.
 */
export async function getMemories(
  db: SupabaseClient,
  workspaceId: string,
  leadId?: string
): Promise<AgentMemory[]> {
  // Always load workspace-level facts (lead_id IS NULL)
  const { data: workspaceFacts } = await db
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("lead_id", null)
    .eq("is_current", true)
    .order("category")
    .order("fact_key");

  if (!leadId) {
    return (workspaceFacts ?? []) as AgentMemory[];
  }

  // Also load lead-specific facts
  const { data: leadFacts } = await db
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .eq("is_current", true)
    .order("category")
    .order("fact_key");

  // Merge: lead-level facts override workspace-level facts with same key
  const merged = new Map<string, AgentMemory>();
  for (const fact of (workspaceFacts ?? []) as AgentMemory[]) {
    merged.set(fact.fact_key, fact);
  }
  for (const fact of (leadFacts ?? []) as AgentMemory[]) {
    merged.set(fact.fact_key, fact); // override
  }

  return [...merged.values()];
}

/**
 * Get a specific fact by key.
 * Checks lead-level first, falls back to workspace-level.
 */
export async function getMemoryByKey(
  db: SupabaseClient,
  workspaceId: string,
  factKey: string,
  leadId?: string
): Promise<AgentMemory | null> {
  // Check lead-level first
  if (leadId) {
    const { data } = await db
      .from("agent_memories")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId)
      .eq("fact_key", factKey)
      .eq("is_current", true)
      .single();
    if (data) return data as AgentMemory;
  }

  // Fall back to workspace-level
  const { data } = await db
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("lead_id", null)
    .eq("fact_key", factKey)
    .eq("is_current", true)
    .single();

  return (data as AgentMemory) ?? null;
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Upsert a fact. If the key already exists (for the same workspace+lead scope),
 * the old fact is marked as superseded and a new one is created.
 */
export async function setMemory(
  db: SupabaseClient,
  workspaceId: string,
  factKey: string,
  factValue: unknown,
  category: AgentMemoryCategory,
  source: AgentMemorySource = "user_provided",
  leadId?: string
): Promise<AgentMemory> {
  // Check for existing current fact with this key
  let query = db
    .from("agent_memories")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("fact_key", factKey)
    .eq("is_current", true);

  if (leadId) {
    query = query.eq("lead_id", leadId);
  } else {
    query = query.is("lead_id", null);
  }

  const { data: existing } = await query.single();

  // Insert the new fact
  const { data: newFact, error: insertError } = await db
    .from("agent_memories")
    .insert({
      workspace_id: workspaceId,
      lead_id: leadId ?? null,
      fact_key: factKey,
      fact_value: factValue,
      category,
      source,
      is_current: true,
    })
    .select("*")
    .single();

  if (insertError) {
    // If unique constraint violation, the old one needs superseding first
    if (existing?.id) {
      await db
        .from("agent_memories")
        .update({
          is_current: false,
          superseded_by: null, // will be set after new insert
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      // Retry insert
      const { data: retryFact, error: retryError } = await db
        .from("agent_memories")
        .insert({
          workspace_id: workspaceId,
          lead_id: leadId ?? null,
          fact_key: factKey,
          fact_value: factValue,
          category,
          source,
          is_current: true,
        })
        .select("*")
        .single();

      if (retryError) throw retryError;

      // Link the old fact to the new one
      await db
        .from("agent_memories")
        .update({ superseded_by: retryFact!.id })
        .eq("id", existing.id);

      return retryFact as AgentMemory;
    }
    throw insertError;
  }

  // If there was an existing fact, supersede it
  if (existing?.id && newFact) {
    await db
      .from("agent_memories")
      .update({
        is_current: false,
        superseded_by: newFact.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  }

  return newFact as AgentMemory;
}

/**
 * Soft-delete a fact by marking it as no longer current.
 */
export async function deleteMemory(
  db: SupabaseClient,
  workspaceId: string,
  factKey: string,
  leadId?: string
): Promise<boolean> {
  let query = db
    .from("agent_memories")
    .update({
      is_current: false,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("fact_key", factKey)
    .eq("is_current", true);

  if (leadId) {
    query = query.eq("lead_id", leadId);
  } else {
    query = query.is("lead_id", null);
  }

  const { error } = await query;
  return !error;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format memories into a prompt-friendly string, grouped by category.
 */
export function formatMemoriesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) return "";

  const grouped = new Map<string, AgentMemory[]>();
  for (const m of memories) {
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    payment: "Payment & Banking",
    company: "Company Information",
    legal: "Legal & Contracts",
    preference: "Preferences",
    contact: "Contact Details",
    product: "Product & Service",
    pricing: "Pricing",
    technical: "Technical Details",
  };

  const sections: string[] = [];
  for (const [category, facts] of grouped) {
    const label = CATEGORY_LABELS[category] ?? category;
    const lines = facts.map((f) => {
      const val = typeof f.fact_value === "string" ? f.fact_value : JSON.stringify(f.fact_value);
      return `- ${f.fact_key}: ${val}`;
    });
    sections.push(`### ${label}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

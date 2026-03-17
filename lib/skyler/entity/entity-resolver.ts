/**
 * Entity Resolver — deterministic entity resolution for Skyler chat (Stage 12, Part A).
 *
 * Resolves which lead the user is talking about BEFORE any LLM call.
 * Priority: explicit tag > named entity > conversation's current entity > pronoun.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolvedEntity = {
  entityId: string;
  entityName: string;
  companyName: string;
  contactEmail: string;
  confidence: number;
  source: "explicit_tag" | "named_entity" | "conversation_state" | "pronoun" | "none";
};

export type EntityFocusEntry = {
  entity_id: string;
  entity_name: string;
  company_name: string;
  entered_turn: number;
  reason: string;
};

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the active entity from message + context.
 * Runs in code BEFORE Claude is called.
 */
export async function resolveActiveEntity(
  db: SupabaseClient,
  workspaceId: string,
  message: string,
  pipelineContext: Record<string, unknown> | null,
  conversationState: {
    activeEntityId?: string | null;
    activeEntityName?: string | null;
    entityFocusStack?: EntityFocusEntry[];
  } | null
): Promise<ResolvedEntity | null> {
  // Priority 1: Explicit tag in current message (from UI pipeline context)
  if (pipelineContext?.pipeline_id) {
    const entityId = pipelineContext.pipeline_id as string;
    const entityName = (pipelineContext.contact_name as string) ?? "Unknown";
    const companyName = (pipelineContext.company_name as string) ?? "";
    const contactEmail = (pipelineContext.contact_email as string) ?? "";

    console.log(`[entity-resolver] Priority 1: Explicit tag → ${entityName} (${entityId})`);
    return {
      entityId,
      entityName,
      companyName,
      contactEmail,
      confidence: 1.0,
      source: "explicit_tag",
    };
  }

  // Priority 2: Named entity in message (no tag — user mentions a name)
  const namedEntity = await resolveNamedEntity(db, workspaceId, message);
  if (namedEntity) {
    console.log(`[entity-resolver] Priority 2: Named entity → ${namedEntity.entityName} (${namedEntity.entityId})`);
    return namedEntity;
  }

  // Priority 3: Conversation's current active entity
  if (conversationState?.activeEntityId) {
    // Verify entity still exists
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, company_name, contact_email")
      .eq("id", conversationState.activeEntityId)
      .single();

    if (pipeline) {
      console.log(`[entity-resolver] Priority 3: Conversation state → ${pipeline.contact_name} (${pipeline.id})`);
      return {
        entityId: pipeline.id,
        entityName: pipeline.contact_name ?? conversationState.activeEntityName ?? "Unknown",
        companyName: pipeline.company_name ?? "",
        contactEmail: pipeline.contact_email ?? "",
        confidence: 0.8,
        source: "conversation_state",
      };
    }
  }

  // Priority 4: Pronoun resolution — "this lead", "that contact", "them"
  if (hasPronounReference(message) && conversationState?.entityFocusStack?.length) {
    const top = conversationState.entityFocusStack[0];
    if (top) {
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("id, contact_name, company_name, contact_email")
        .eq("id", top.entity_id)
        .single();

      if (pipeline) {
        console.log(`[entity-resolver] Priority 4: Pronoun → ${pipeline.contact_name} (${pipeline.id})`);
        return {
          entityId: pipeline.id,
          entityName: pipeline.contact_name ?? top.entity_name,
          companyName: pipeline.company_name ?? top.company_name,
          contactEmail: pipeline.contact_email ?? "",
          confidence: 0.7,
          source: "pronoun",
        };
      }
    }
  }

  console.log("[entity-resolver] No entity resolved");
  return null;
}

// ── Priority 2: Named entity extraction ──────────────────────────────────────

async function resolveNamedEntity(
  db: SupabaseClient,
  workspaceId: string,
  message: string
): Promise<ResolvedEntity | null> {
  // Quick check: does the message look like it mentions a person or company?
  // Skip named entity extraction for generic messages
  if (message.length < 10 || !/[A-Z]/.test(message)) return null;

  try {
    // Extract names using GPT-4o-mini
    const result = await routedLLMCall({
      task: "extract-entity-names",
      tier: "fast",
      systemPrompt: `Extract person names and company names from the user's message.
Only extract names that the user seems to be referring to as a lead/contact/client.
Do NOT extract the user's own name or generic terms.

Return ONLY valid JSON:
{ "names": ["Name1", "Company1"] }
If no lead/client names found, return: { "names": [] }`,
      userContent: message,
      maxTokens: 100,
    });

    const parsed = parseAIJson(result.text);
    const names = (parsed.names ?? []) as string[];
    if (names.length === 0) return null;

    // Match against pipeline records
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed.length < 2) continue;

      // Search by contact name or company name (case-insensitive)
      const { data: matches } = await db
        .from("skyler_sales_pipeline")
        .select("id, contact_name, company_name, contact_email")
        .eq("workspace_id", workspaceId)
        .is("resolution", null)
        .or(`contact_name.ilike.%${trimmed}%,company_name.ilike.%${trimmed}%`)
        .limit(5);

      if (matches && matches.length === 1) {
        // Exactly one match — use it
        return {
          entityId: matches[0].id,
          entityName: matches[0].contact_name ?? trimmed,
          companyName: matches[0].company_name ?? "",
          contactEmail: matches[0].contact_email ?? "",
          confidence: 0.85,
          source: "named_entity",
        };
      }

      // Multiple matches — ambiguous, return null (Skyler will ask for clarification)
      if (matches && matches.length > 1) {
        console.log(`[entity-resolver] Ambiguous name "${trimmed}": ${matches.length} matches`);
        return null;
      }
    }
  } catch (err) {
    console.error("[entity-resolver] Named entity extraction failed:", err instanceof Error ? err.message : err);
  }

  return null;
}

// ── Pronoun detection ────────────────────────────────────────────────────────

function hasPronounReference(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(this lead|that lead|this contact|that contact|them|their|her|his|this one|this person)\b/.test(lower);
}

// ── Focus stack management ───────────────────────────────────────────────────

/**
 * Update the entity focus stack when an entity is resolved.
 * Most recent entity goes to the top (index 0).
 */
export function updateFocusStack(
  currentStack: EntityFocusEntry[],
  entity: ResolvedEntity,
  turnNumber: number
): EntityFocusEntry[] {
  // Remove if already in stack
  const filtered = currentStack.filter((e) => e.entity_id !== entity.entityId);

  // Push to top
  const newEntry: EntityFocusEntry = {
    entity_id: entity.entityId,
    entity_name: entity.entityName,
    company_name: entity.companyName,
    entered_turn: turnNumber,
    reason: entity.source,
  };

  // Keep max 10 entries
  return [newEntry, ...filtered].slice(0, 10);
}

/**
 * Update conversation record with the resolved entity.
 */
export async function updateConversationEntity(
  db: SupabaseClient,
  conversationId: string,
  entity: ResolvedEntity,
  focusStack: EntityFocusEntry[]
): Promise<void> {
  await db
    .from("conversations")
    .update({
      active_entity_id: entity.entityId,
      active_entity_type: "lead",
      active_entity_name: entity.entityName,
      entity_focus_stack: focusStack,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
}

/**
 * Load conversation entity state.
 */
export async function loadConversationEntityState(
  db: SupabaseClient,
  conversationId: string
): Promise<{
  activeEntityId: string | null;
  activeEntityName: string | null;
  entityFocusStack: EntityFocusEntry[];
} | null> {
  const { data } = await db
    .from("conversations")
    .select("active_entity_id, active_entity_name, entity_focus_stack")
    .eq("id", conversationId)
    .single();

  if (!data) return null;

  return {
    activeEntityId: data.active_entity_id,
    activeEntityName: data.active_entity_name,
    entityFocusStack: (data.entity_focus_stack ?? []) as EntityFocusEntry[],
  };
}

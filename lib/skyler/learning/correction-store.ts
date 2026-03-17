/**
 * Correction store — CRUD for agent_corrections table (Stage 11).
 *
 * Stores learning corrections from rejections, chat feedback, and implicit signals.
 * Uses a write controller that defaults to NOOP unless the signal is clearly valuable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentCorrection = {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  correction_type: string;
  scope: string;
  original_action: Record<string, unknown> | null;
  correction_text: string;
  clarification_text: string | null;
  derived_rule: string | null;
  context_metadata: Record<string, unknown> | null;
  source: string;
  source_decision_id: string | null;
  confidence: number;
  is_active: boolean;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  expires_at: string | null;
};

type StoreParams = {
  workspaceId: string;
  leadId?: string | null;
  correctionType: string;
  scope: string;
  originalAction?: Record<string, unknown> | null;
  correctionText: string;
  clarificationText?: string | null;
  derivedRule?: string | null;
  contextMetadata?: Record<string, unknown> | null;
  source: string;
  sourceDecisionId?: string | null;
  confidence?: number;
  expiresAt?: string | null;
};

/**
 * Store a new correction. Checks for duplicates first.
 * Returns the ID of the stored or updated correction, or null if NOOP.
 */
export async function storeCorrection(
  db: SupabaseClient,
  params: StoreParams
): Promise<string | null> {
  // Check for existing similar correction (same type + scope + workspace)
  const { data: existing } = await db
    .from("agent_corrections")
    .select("id, correction_text, derived_rule, access_count, confidence")
    .eq("workspace_id", params.workspaceId)
    .eq("correction_type", params.correctionType)
    .eq("scope", params.scope)
    .eq("is_active", true)
    .limit(20);

  // Simple text similarity check — if very similar correction exists, update it
  const similar = (existing ?? []).find((e) => {
    const sim = textSimilarity(e.correction_text, params.correctionText);
    return sim > 0.7;
  });

  if (similar) {
    // Update existing correction — merge, don't duplicate
    await db
      .from("agent_corrections")
      .update({
        correction_text: params.correctionText,
        derived_rule: params.derivedRule ?? similar.derived_rule,
        confidence: Math.min(1.0, (similar.confidence ?? 0.5) + 0.1),
        access_count: (similar.access_count ?? 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", similar.id);

    console.log(`[correction-store] Updated existing correction ${similar.id}`);
    return similar.id;
  }

  // Determine expiry — temporary corrections for specific instances
  let expiresAt = params.expiresAt;
  if (!expiresAt && params.scope === "lead_specific" && !isStrongSignal(params.source)) {
    // Lead-specific corrections from weak sources expire in 30 days
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data, error } = await db
    .from("agent_corrections")
    .insert({
      workspace_id: params.workspaceId,
      lead_id: params.leadId ?? null,
      correction_type: params.correctionType,
      scope: params.scope,
      original_action: params.originalAction ?? null,
      correction_text: params.correctionText,
      clarification_text: params.clarificationText ?? null,
      derived_rule: params.derivedRule ?? null,
      context_metadata: params.contextMetadata ?? null,
      source: params.source,
      source_decision_id: params.sourceDecisionId ?? null,
      confidence: params.confidence ?? 1.0,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[correction-store] Insert failed:", error.message);
    return null;
  }

  console.log(`[correction-store] Stored new correction ${data?.id}`);
  return data?.id ?? null;
}

/**
 * Get active corrections for a workspace, optionally filtered by type/scope.
 */
export async function getActiveCorrections(
  db: SupabaseClient,
  workspaceId: string,
  opts?: { leadId?: string; correctionType?: string; limit?: number }
): Promise<AgentCorrection[]> {
  let query = db
    .from("agent_corrections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 50);

  if (opts?.correctionType) {
    query = query.eq("correction_type", opts.correctionType);
  }

  const { data } = await query;
  const corrections = (data ?? []) as unknown as AgentCorrection[];

  // If a lead ID is provided, include both workspace-scoped and lead-specific corrections
  if (opts?.leadId) {
    return corrections.filter(
      (c) => c.scope === "workspace" || c.scope === "global" || c.lead_id === opts.leadId
    );
  }

  return corrections;
}

/**
 * Mark a correction as accessed (for retrieval score tracking).
 */
export async function touchCorrection(db: SupabaseClient, correctionId: string): Promise<void> {
  // Fetch current count and increment
  const { data } = await db
    .from("agent_corrections")
    .select("access_count")
    .eq("id", correctionId)
    .single();

  await db
    .from("agent_corrections")
    .update({
      access_count: ((data?.access_count as number) ?? 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", correctionId);
}

/**
 * Format corrections for injection into the reasoning prompt.
 * Budget: ~400 tokens (roughly 5 corrections with derived rules).
 */
export function formatCorrectionsForPrompt(corrections: AgentCorrection[]): string {
  if (corrections.length === 0) return "";

  const lines = corrections
    .filter((c) => c.derived_rule)
    .slice(0, 5)
    .map((c) => {
      const scope = c.scope === "global" || c.scope === "workspace" ? "" : ` (${c.scope})`;
      return `- ${c.derived_rule}${scope}`;
    });

  if (lines.length === 0) return "";

  return `### Lessons from past corrections\n${lines.join("\n")}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple word-overlap similarity (0-1). */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Sources with high trust don't need expiry. */
function isStrongSignal(source: string): boolean {
  return ["admin_user", "user_provided", "rejection_reason"].includes(source);
}

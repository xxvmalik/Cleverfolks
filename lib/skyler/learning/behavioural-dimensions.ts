/**
 * Behavioural Dimensions tracker (Stage 11, Part E).
 *
 * Tracks 6 dimensions of Skyler's communication style per workspace.
 * Each dimension ranges from -1.0 to +1.0, shifted by ±0.1 per correction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DIMENSIONS = [
  "warmth",        // cold (-1) ↔ warm (+1)
  "formality",     // casual (-1) ↔ formal (+1)
  "assertiveness", // passive (-1) ↔ aggressive (+1)
  "verbosity",     // concise (-1) ↔ detailed (+1)
  "urgency",       // patient (-1) ↔ pushy (+1)
  "personalization",// generic (-1) ↔ highly personal (+1)
] as const;

export type DimensionName = (typeof DIMENSIONS)[number];

export type BehaviouralDimension = {
  id: string;
  workspace_id: string;
  dimension: DimensionName;
  score: number;
  context_scope: string;
  context_criteria: Record<string, unknown> | null;
  updated_at: string;
};

const DIMENSION_LABELS: Record<DimensionName, [string, string]> = {
  warmth: ["cold", "warm"],
  formality: ["casual", "formal"],
  assertiveness: ["passive", "aggressive"],
  verbosity: ["concise", "detailed"],
  urgency: ["patient", "pushy"],
  personalization: ["generic", "highly personal"],
};

/**
 * Get all behavioural dimensions for a workspace (global scope).
 * Initialises missing dimensions to 0.0.
 */
export async function getDimensions(
  db: SupabaseClient,
  workspaceId: string,
  scope = "global"
): Promise<BehaviouralDimension[]> {
  const { data } = await db
    .from("behavioural_dimensions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("context_scope", scope);

  const existing = (data ?? []) as unknown as BehaviouralDimension[];
  const existingDims = new Set(existing.map((d) => d.dimension));

  // Initialize any missing dimensions
  const missing = DIMENSIONS.filter((d) => !existingDims.has(d));
  if (missing.length > 0) {
    const inserts = missing.map((dimension) => ({
      workspace_id: workspaceId,
      dimension,
      score: 0.0,
      context_scope: scope,
    }));

    const { data: newDims } = await db
      .from("behavioural_dimensions")
      .upsert(inserts, { onConflict: "workspace_id,dimension,context_scope" })
      .select("*");

    if (newDims) {
      existing.push(...(newDims as unknown as BehaviouralDimension[]));
    }
  }

  return existing;
}

/**
 * Shift a dimension by a small increment (±0.1 by default).
 * Clamped to [-1.0, +1.0].
 */
export async function shiftDimension(
  db: SupabaseClient,
  workspaceId: string,
  dimension: DimensionName,
  direction: number,
  scope = "global"
): Promise<number> {
  // Clamp direction to ±0.1 increments
  const shift = direction > 0 ? 0.1 : -0.1;

  // Get current score
  const { data } = await db
    .from("behavioural_dimensions")
    .select("id, score")
    .eq("workspace_id", workspaceId)
    .eq("dimension", dimension)
    .eq("context_scope", scope)
    .single();

  const currentScore = data?.score ?? 0.0;
  const newScore = Math.max(-1.0, Math.min(1.0, currentScore + shift));

  if (data) {
    await db
      .from("behavioural_dimensions")
      .update({ score: newScore, updated_at: new Date().toISOString() })
      .eq("id", data.id);
  } else {
    await db
      .from("behavioural_dimensions")
      .insert({
        workspace_id: workspaceId,
        dimension,
        score: newScore,
        context_scope: scope,
      });
  }

  console.log(`[behavioural-dimensions] ${dimension}: ${currentScore.toFixed(1)} → ${newScore.toFixed(1)} (${scope})`);
  return newScore;
}

/**
 * Format dimensions for injection into the reasoning prompt.
 * Budget: ~100 tokens.
 */
export function formatDimensionsForPrompt(dimensions: BehaviouralDimension[]): string {
  if (dimensions.length === 0) return "";

  const lines = dimensions
    .filter((d) => DIMENSIONS.includes(d.dimension as DimensionName))
    .map((d) => {
      const labels = DIMENSION_LABELS[d.dimension as DimensionName];
      if (!labels) return null;
      const desc =
        d.score > 0.3
          ? labels[1]
          : d.score < -0.3
          ? labels[0]
          : d.score > 0.1
          ? `slightly ${labels[1]}`
          : d.score < -0.1
          ? `slightly ${labels[0]}`
          : "balanced";
      return `${d.dimension}=${d.score.toFixed(1)} (${desc})`;
    })
    .filter(Boolean);

  if (lines.length === 0) return "";

  return `### Communication style (current calibration)\n${lines.join(", ")}`;
}

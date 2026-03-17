/**
 * Golden Examples store — learns from successful decisions (Stage 11, Part D).
 *
 * When a decision is approved (especially without edits), it becomes a golden
 * example that can be retrieved for similar future situations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type GoldenExample = {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  decision_id: string | null;
  task_type: string;
  input_context: Record<string, unknown>;
  agent_output: Record<string, unknown>;
  composite_score: number;
  approval_speed_seconds: number | null;
  edit_distance: number | null;
  outcome_score: number | null;
  is_active: boolean;
  created_at: string;
  use_count: number;
};

/**
 * Compute the composite quality score for a golden example.
 */
export function computeCompositeScore(params: {
  approved: boolean;
  editDistance: number;
  approvalSpeedSeconds: number;
  outcomeScore?: number;
}): number {
  const approvalScore = params.approved ? (params.editDistance > 0.3 ? 0.5 : 1.0) : -1.0;

  let timeScore = 0.3;
  if (params.approvalSpeedSeconds < 30) timeScore = 1.0;
  else if (params.approvalSpeedSeconds < 120) timeScore = 0.5;

  const score =
    0.4 * approvalScore +
    0.25 * (1.0 - Math.min(params.editDistance, 1.0)) +
    0.2 * timeScore +
    0.15 * (params.outcomeScore ?? 0.0);

  return Math.round(score * 1000) / 1000;
}

/**
 * Create a golden example from an approved decision.
 */
export async function createGoldenExample(
  db: SupabaseClient,
  params: {
    workspaceId: string;
    leadId?: string | null;
    decisionId: string;
    taskType: string;
    inputContext: Record<string, unknown>;
    agentOutput: Record<string, unknown>;
    approvalSpeedSeconds: number;
    editDistance: number;
  }
): Promise<string | null> {
  const compositeScore = computeCompositeScore({
    approved: true,
    editDistance: params.editDistance,
    approvalSpeedSeconds: params.approvalSpeedSeconds,
  });

  // Only store if the score is positive (good examples only)
  if (compositeScore <= 0) {
    console.log(`[golden-examples] Score too low (${compositeScore}), not storing`);
    return null;
  }

  // Check budget: max 50 per task type per workspace
  const { data: existingExamples } = await db
    .from("golden_examples")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("task_type", params.taskType)
    .eq("is_active", true);

  if ((existingExamples?.length ?? 0) >= 50) {
    // Evict the lowest-scoring example
    const { data: lowest } = await db
      .from("golden_examples")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("task_type", params.taskType)
      .eq("is_active", true)
      .order("composite_score", { ascending: true })
      .limit(1)
      .single();

    if (lowest && compositeScore > 0) {
      await db
        .from("golden_examples")
        .update({ is_active: false })
        .eq("id", lowest.id);
    }
  }

  const { data, error } = await db
    .from("golden_examples")
    .insert({
      workspace_id: params.workspaceId,
      lead_id: params.leadId ?? null,
      decision_id: params.decisionId,
      task_type: params.taskType,
      input_context: params.inputContext,
      agent_output: params.agentOutput,
      composite_score: compositeScore,
      approval_speed_seconds: params.approvalSpeedSeconds,
      edit_distance: params.editDistance,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[golden-examples] Insert failed:", error.message);
    return null;
  }

  console.log(`[golden-examples] Stored example ${data?.id} (score: ${compositeScore})`);
  return data?.id ?? null;
}

/**
 * Get top golden examples for a task type in a workspace.
 * Returns up to 3, sorted by composite_score descending.
 */
export async function getGoldenExamples(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  limit = 3
): Promise<GoldenExample[]> {
  const { data } = await db
    .from("golden_examples")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("task_type", taskType)
    .eq("is_active", true)
    .order("composite_score", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as GoldenExample[];
}

/**
 * Update a golden example's outcome score (from Part G outcome tracking).
 */
export async function updateOutcomeScore(
  db: SupabaseClient,
  goldenExampleId: string,
  outcomeScore: number
): Promise<void> {
  // Fetch current scores to recalculate composite
  const { data: example } = await db
    .from("golden_examples")
    .select("approval_speed_seconds, edit_distance")
    .eq("id", goldenExampleId)
    .single();

  if (!example) return;

  const compositeScore = computeCompositeScore({
    approved: true,
    editDistance: example.edit_distance ?? 0,
    approvalSpeedSeconds: example.approval_speed_seconds ?? 60,
    outcomeScore,
  });

  await db
    .from("golden_examples")
    .update({
      outcome_score: outcomeScore,
      composite_score: compositeScore,
    })
    .eq("id", goldenExampleId);
}

/**
 * Format golden examples for injection into the reasoning prompt.
 * Budget: ~600 tokens (3 examples, truncated).
 */
export function formatGoldenExamplesForPrompt(examples: GoldenExample[]): string {
  if (examples.length === 0) return "";

  const lines = examples.map((e, i) => {
    const ctx = e.input_context;
    const out = e.agent_output;
    const stage = (ctx.stage as string) ?? "unknown";
    const action = (out.action_type as string) ?? "unknown";
    const reasoning = ((out.reasoning as string) ?? "").slice(0, 150);
    const score = e.composite_score.toFixed(2);

    return `${i + 1}. [${stage}] → ${action} (score: ${score})\n   Reasoning: ${reasoning}`;
  });

  return `### Examples of decisions that were approved and successful\n${lines.join("\n")}`;
}

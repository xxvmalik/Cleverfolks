/**
 * Confidence Tracking — dynamic autonomy based on track record (Stage 11, Part F).
 *
 * Uses a Beta distribution (alpha/beta) + EWMA to track Skyler's approval rate
 * per task type. Autonomy levels are earned, not given.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfidenceRecord = {
  id: string;
  workspace_id: string;
  task_type: string;
  alpha: number;
  beta: number;
  ewma: number;
  total_decisions: number;
  autonomy_level: "autonomous" | "review" | "blocked";
  last_updated_at: string;
};

export const TRACKED_TASK_TYPES = [
  "initial_outreach",
  "follow_up_email",
  "objection_handling",
  "meeting_followup",
  "stage_update",
  "lead_qualification",
] as const;

export type TrackedTaskType = (typeof TRACKED_TASK_TYPES)[number];

/**
 * Map a decision's action_type + context to a tracked task type.
 */
export function inferTrackedTaskType(
  actionType: string,
  context?: { stage?: string; isObjection?: boolean; isMeetingFollowup?: boolean }
): TrackedTaskType | null {
  if (actionType === "update_stage") return "stage_update";
  if (actionType === "draft_email") {
    if (context?.isObjection) return "objection_handling";
    if (context?.isMeetingFollowup) return "meeting_followup";
    if (context?.stage === "initial_outreach") return "initial_outreach";
    return "follow_up_email";
  }
  return null;
}

/**
 * Get or initialize confidence tracking for a task type.
 */
export async function getConfidence(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string
): Promise<ConfidenceRecord | null> {
  const { data } = await db
    .from("confidence_tracking")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("task_type", taskType)
    .single();

  return (data as unknown as ConfidenceRecord) ?? null;
}

/**
 * Record a decision outcome and update confidence scores.
 */
export async function recordOutcome(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  outcome: "approved" | "rejected" | "approved_with_heavy_edits"
): Promise<ConfidenceRecord> {
  // Get or create the record
  let record = await getConfidence(db, workspaceId, taskType);

  if (!record) {
    const { data } = await db
      .from("confidence_tracking")
      .insert({
        workspace_id: workspaceId,
        task_type: taskType,
        alpha: 1.0,
        beta: 1.0,
        ewma: 0.5,
        total_decisions: 0,
        autonomy_level: "blocked",
      })
      .select("*")
      .single();

    record = data as unknown as ConfidenceRecord;
    if (!record) throw new Error(`Failed to create confidence record for ${taskType}`);
  }

  // Update based on outcome
  let newAlpha = record.alpha;
  let newBeta = record.beta;
  let successSignal: number;

  switch (outcome) {
    case "approved":
      newAlpha += 1;
      successSignal = 1.0;
      break;
    case "rejected":
      newBeta += 1;
      successSignal = 0.0;
      break;
    case "approved_with_heavy_edits":
      newAlpha += 0.3;
      newBeta += 0.7;
      successSignal = 0.3;
      break;
  }

  const newEwma = 0.15 * successSignal + 0.85 * record.ewma;
  const newTotal = record.total_decisions + 1;

  // Derive autonomy level
  let autonomyLevel: "autonomous" | "review" | "blocked";
  if (newEwma >= 0.85 && newTotal >= 20) {
    autonomyLevel = "autonomous";
  } else if (newEwma >= 0.60 || newTotal < 20) {
    autonomyLevel = "review";
  } else {
    autonomyLevel = "blocked";
  }

  await db
    .from("confidence_tracking")
    .update({
      alpha: newAlpha,
      beta: newBeta,
      ewma: Math.round(newEwma * 1000) / 1000,
      total_decisions: newTotal,
      autonomy_level: autonomyLevel,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);

  console.log(`[confidence] ${taskType}: ewma=${newEwma.toFixed(3)}, total=${newTotal}, level=${autonomyLevel}`);

  return {
    ...record,
    alpha: newAlpha,
    beta: newBeta,
    ewma: newEwma,
    total_decisions: newTotal,
    autonomy_level: autonomyLevel,
    last_updated_at: new Date().toISOString(),
  };
}

/**
 * Format confidence info for injection into the reasoning prompt.
 * Budget: ~100 tokens.
 */
export function formatConfidenceForPrompt(record: ConfidenceRecord | null, taskType: string): string {
  if (!record || record.total_decisions === 0) return "";

  const approvalRate = Math.round((record.alpha / (record.alpha + record.beta)) * 100);
  return `### Your confidence for this task type\n${taskType}: ${approvalRate}% approval rate over ${record.total_decisions} decisions. Autonomy level: ${record.autonomy_level}.`;
}

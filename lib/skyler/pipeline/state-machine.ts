/**
 * Stage 15 — Finite State Machine for pipeline stage transitions.
 *
 * Defines which stage transitions are valid. Invalid transitions are blocked
 * before they happen. Used by every stage update path in the codebase.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

// ── Valid transition map ────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  // Phase 1: Prospecting
  initial_outreach: ["follow_up_1", "replied", "no_response", "disqualified"],
  follow_up_1: ["follow_up_2", "replied", "no_response", "disqualified"],
  follow_up_2: ["follow_up_3", "replied", "no_response", "disqualified"],
  follow_up_3: ["replied", "no_response", "disqualified"],

  // Phase 2: Engaged
  replied: [
    "demo_booked",
    "negotiation",
    "pending_clarification",
    "proposal",
    "stalled",
    "disqualified",
    "closed_lost",
    "meeting_booked",
  ],
  pending_clarification: [
    "replied",
    "demo_booked",
    "negotiation",
    "stalled",
    "disqualified",
  ],
  demo_booked: [
    "negotiation",
    "proposal",
    "pending_clarification",
    "stalled",
    "disqualified",
    "closed_lost",
    "follow_up_meeting",
    "payment_secured",
    "closed_won",
  ],
  negotiation: [
    "proposal",
    "demo_booked",
    "pending_clarification",
    "payment_secured",
    "closed_won",
    "closed_lost",
    "stalled",
    "meeting_booked",
  ],
  proposal: [
    "negotiation",
    "payment_secured",
    "closed_won",
    "closed_lost",
    "stalled",
  ],
  meeting_booked: [
    "demo_booked",
    "negotiation",
    "pending_clarification",
    "stalled",
    "follow_up_meeting",
    "closed_lost",
  ],
  follow_up_meeting: [
    "negotiation",
    "proposal",
    "demo_booked",
    "stalled",
    "closed_lost",
    "closed_won",
    "payment_secured",
  ],

  // Phase 3: Resolved
  payment_secured: ["closed_won"],
  closed_won: [], // Terminal
  closed_lost: [], // Terminal
  no_response: ["replied", "stalled"],
  stalled: ["replied", "follow_up_1", "disqualified", "closed_lost"],
  disqualified: [], // Terminal
};

// ── Public API ──────────────────────────────────────────────────────────────

export function isValidTransition(
  fromStage: string,
  toStage: string
): boolean {
  if (fromStage === toStage) return true; // No-op is always valid
  const valid = VALID_TRANSITIONS[fromStage];
  if (!valid) return false; // Unknown stage — reject
  return valid.includes(toStage);
}

export function getValidNextStages(currentStage: string): string[] {
  return VALID_TRANSITIONS[currentStage] ?? [];
}

/**
 * Validate a transition, log it to pipeline_events, and emit the entered-stage event.
 * Returns { valid: true } if the transition is allowed, { valid: false, reason } if not.
 */
export async function validateAndLog(
  leadId: string,
  fromStage: string,
  toStage: string,
  source: string,
  sourceDetail?: string,
  payload?: Record<string, unknown>,
  confidence?: number
): Promise<{ valid: boolean; reason?: string }> {
  if (fromStage === toStage) {
    return { valid: true }; // No-op, no event needed
  }

  const valid = isValidTransition(fromStage, toStage);

  const db = createAdminSupabaseClient();

  if (!valid) {
    // Log the invalid attempt but don't block fatally
    try {
      await db
        .from("pipeline_events")
        .insert({
          lead_id: leadId,
          event_type: "invalid_transition",
          from_stage: fromStage,
          to_stage: toStage,
          source,
          source_detail: sourceDetail,
          payload: { ...payload, blocked: true },
          confidence,
        });
    } catch { /* audit logging should never block */ }

    console.warn(
      `[state-machine] BLOCKED invalid transition: ${fromStage} → ${toStage} for lead ${leadId} (source: ${source})`
    );

    return {
      valid: false,
      reason: `Invalid transition: ${fromStage} → ${toStage}. Valid next stages: ${getValidNextStages(fromStage).join(", ") || "none (terminal state)"}`,
    };
  }

  // Log the valid transition
  try {
    await db
      .from("pipeline_events")
      .insert({
        lead_id: leadId,
        event_type: "stage_changed",
        from_stage: fromStage,
        to_stage: toStage,
        source,
        source_detail: sourceDetail,
        payload: payload ?? {},
        confidence,
      });
  } catch (err) {
    console.error("[state-machine] Failed to log event:", err instanceof Error ? err.message : err);
  }

  // Emit entered-stage event for watchdog timers (fire-and-forget)
  inngest
    .send({
      name: "pipeline/lead.entered-stage",
      data: { leadId, stage: toStage, fromStage, timestamp: new Date().toISOString() },
    })
    .catch(() => {});

  return { valid: true };
}

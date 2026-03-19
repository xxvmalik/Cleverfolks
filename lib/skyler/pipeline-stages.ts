/**
 * Central Pipeline Stage Machine — single source of truth for all Skyler pipeline stages.
 *
 * Every file that reads or writes pipeline.stage should import from here.
 * Adding a new stage means updating THIS file only.
 */

// ── Stage constants ─────────────────────────────────────────────────────────

export const STAGES = {
  INITIAL_OUTREACH: "initial_outreach",
  FOLLOW_UP_1: "follow_up_1",
  FOLLOW_UP_2: "follow_up_2",
  FOLLOW_UP_3: "follow_up_3",
  REPLIED: "replied",
  PENDING_CLARIFICATION: "pending_clarification",
  NEGOTIATION: "negotiation",
  DEMO_BOOKED: "demo_booked",
  PROPOSAL: "proposal",
  PAYMENT_SECURED: "payment_secured",
  MEETING_BOOKED: "meeting_booked",
  FOLLOW_UP_MEETING: "follow_up_meeting",
  CLOSED_WON: "closed_won",
  CLOSED_LOST: "closed_lost",
  DISQUALIFIED: "disqualified",
  NO_RESPONSE: "no_response",
  STALLED: "stalled",
} as const;

export type PipelineStage = (typeof STAGES)[keyof typeof STAGES];

// ── Stage labels (human-readable) ───────────────────────────────────────────

export const STAGE_LABELS: Record<PipelineStage, string> = {
  [STAGES.INITIAL_OUTREACH]: "Initial Outreach",
  [STAGES.FOLLOW_UP_1]: "Follow Up 1",
  [STAGES.FOLLOW_UP_2]: "Follow Up 2",
  [STAGES.FOLLOW_UP_3]: "Follow Up 3",
  [STAGES.REPLIED]: "Replied",
  [STAGES.PENDING_CLARIFICATION]: "Pending Clarification",
  [STAGES.NEGOTIATION]: "Negotiation",
  [STAGES.DEMO_BOOKED]: "Demo Booked",
  [STAGES.PROPOSAL]: "Proposal",
  [STAGES.PAYMENT_SECURED]: "Payment Secured",
  [STAGES.MEETING_BOOKED]: "Meeting Booked",
  [STAGES.FOLLOW_UP_MEETING]: "Follow-Up Meeting",
  [STAGES.CLOSED_WON]: "Closed Won",
  [STAGES.CLOSED_LOST]: "Closed Lost",
  [STAGES.DISQUALIFIED]: "Disqualified",
  [STAGES.NO_RESPONSE]: "No Response",
  [STAGES.STALLED]: "Stalled",
};

// ── Phase groupings ─────────────────────────────────────────────────────────

export type Phase = "prospecting" | "engaged" | "resolved";

const PROSPECTING_STAGES: PipelineStage[] = [
  STAGES.INITIAL_OUTREACH,
  STAGES.FOLLOW_UP_1,
  STAGES.FOLLOW_UP_2,
  STAGES.FOLLOW_UP_3,
];

const ENGAGED_STAGES: PipelineStage[] = [
  STAGES.REPLIED,
  STAGES.PENDING_CLARIFICATION,
  STAGES.NEGOTIATION,
  STAGES.DEMO_BOOKED,
  STAGES.PROPOSAL,
  STAGES.MEETING_BOOKED,
  STAGES.FOLLOW_UP_MEETING,
];

const RESOLVED_POSITIVE: PipelineStage[] = [
  STAGES.PAYMENT_SECURED,
  STAGES.CLOSED_WON,
];

const RESOLVED_NEGATIVE: PipelineStage[] = [
  STAGES.DISQUALIFIED,
  STAGES.CLOSED_LOST,
  STAGES.NO_RESPONSE,
];

export function getPhase(stage: string): Phase {
  if (PROSPECTING_STAGES.includes(stage as PipelineStage)) return "prospecting";
  if (ENGAGED_STAGES.includes(stage as PipelineStage)) return "engaged";
  return "resolved";
}

export function isProspecting(stage: string): boolean {
  return PROSPECTING_STAGES.includes(stage as PipelineStage);
}

export function isEngaged(stage: string): boolean {
  return ENGAGED_STAGES.includes(stage as PipelineStage);
}

export function isResolved(stage: string): boolean {
  return RESOLVED_POSITIVE.includes(stage as PipelineStage) ||
    RESOLVED_NEGATIVE.includes(stage as PipelineStage) ||
    stage === STAGES.STALLED;
}

export function isResolvedPositive(stage: string): boolean {
  return RESOLVED_POSITIVE.includes(stage as PipelineStage);
}

export function isResolvedNegative(stage: string): boolean {
  return RESOLVED_NEGATIVE.includes(stage as PipelineStage);
}

// ── Cadence step → stage mapping ────────────────────────────────────────────

export const CADENCE_STEP_STAGE: Record<number, PipelineStage> = {
  1: STAGES.INITIAL_OUTREACH,
  2: STAGES.FOLLOW_UP_1,
  3: STAGES.FOLLOW_UP_2,
  4: STAGES.FOLLOW_UP_3,
};

// ── Stage for replies ───────────────────────────────────────────────────────

/** Determine the new stage when a lead replies to outreach */
export function stageOnReply(currentStage: string): PipelineStage {
  if (
    currentStage === STAGES.INITIAL_OUTREACH ||
    currentStage.startsWith("follow_up") ||
    currentStage === STAGES.NO_RESPONSE
  ) {
    return STAGES.REPLIED;
  }
  return currentStage as PipelineStage;
}

/** Get a stage label, falling back to a formatted version of the raw value */
export function getStageLabel(stage: string): string {
  return STAGE_LABELS[stage as PipelineStage] ??
    stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

"use client";

const STAGE_LABELS: Record<string, string> = {
  initial_outreach: "Initial Outreach",
  follow_up_1: "Follow Up 1",
  follow_up_2: "Follow Up 2",
  follow_up_3: "Follow Up 3",
  replied: "Replied",
  pending_clarification: "Pending Clarification",
  negotiation: "Negotiation",
  demo_booked: "Demo Booked",
  proposal: "Proposal",
  payment_secured: "Payment Secured",
  closed_won: "Closed Won",
  meeting_booked: "Meeting Booked",
  disqualified: "Disqualified",
  closed_lost: "Closed Lost",
  no_response: "No Response",
  stalled: "Stalled",
};

function getPhaseColor(stage: string): string {
  // Phase 1: Prospecting
  if (["initial_outreach", "follow_up_1", "follow_up_2", "follow_up_3"].includes(stage)) {
    return "#0086FF";
  }
  // Phase 2: Engaged
  if (["replied", "pending_clarification", "negotiation", "demo_booked", "proposal", "meeting_booked", "follow_up_meeting"].includes(stage)) {
    return "#F2903D";
  }
  // Phase 3: Resolved — positive
  if (["payment_secured", "closed_won"].includes(stage)) {
    return "#3ECF8E";
  }
  // Phase 3: Resolved — negative
  if (["disqualified", "closed_lost", "no_response"].includes(stage)) {
    return "#E54545";
  }
  // Phase 3: Resolved — neutral
  if (stage === "stalled") return "#C6E84B";
  return "#F2903D";
}

export function getPhaseForStage(stage: string): "prospecting" | "engaged" | "resolved" {
  if (["initial_outreach", "follow_up_1", "follow_up_2", "follow_up_3"].includes(stage)) return "prospecting";
  if (["replied", "pending_clarification", "negotiation", "demo_booked", "proposal", "meeting_booked", "follow_up_meeting"].includes(stage)) return "engaged";
  return "resolved";
}

export function StageBadge({ stage }: { stage: string }) {
  const color = getPhaseColor(stage);
  const label = STAGE_LABELS[stage] ?? stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      style={{
        background: `${color}18`,
        color: color,
        border: `1px solid ${color}30`,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * Guardrail Engine for Skyler's AI reasoning pipeline.
 *
 * Pure function — no AI calls, no database queries, no side effects.
 * Checks every AI decision against the user's Workflow Settings and lead
 * context before it gets executed.
 *
 * The check sequence order matters — earlier checks take priority.
 */

import type { SkylerDecision } from "./decision-schema";
import type { SkylerWorkflowSettings } from "@/app/api/skyler/workflow-settings/route";
import { scanForPlaceholders } from "./output-validator";

// ── Types ────────────────────────────────────────────────────────────────────

/** Lead context passed into the guardrail check */
export type GuardrailLeadContext = {
  emails_sent: number;
  deal_value?: number;
  is_vip?: boolean;
  is_c_suite?: boolean;
};

/** The four possible outcomes */
export type GuardrailOutcome =
  | "auto_execute"
  | "await_approval"
  | "request_info"
  | "escalate";

/** Detailed result with the outcome + reason for logging/transparency */
export type GuardrailResult = {
  outcome: GuardrailOutcome;
  reason: string;
  /** Resolved escalation channel from Workflow Settings (not the AI's suggestion) */
  escalation_channel?: "slack" | "email" | "task";
  /** Banned phrases found in the email content, if any */
  flagged_phrases?: string[];
};

// ── Core guardrail check ─────────────────────────────────────────────────────

export function checkGuardrails(
  decision: SkylerDecision,
  settings: SkylerWorkflowSettings,
  lead: GuardrailLeadContext
): GuardrailResult {
  const esc = settings.escalationRules;

  // ── 1. Escalation rules (hard overrides) ────────────────────────────────
  if (
    esc.dealValueExceedsThreshold &&
    lead.deal_value != null &&
    lead.deal_value > (esc.dealValueThreshold ?? 5000)
  ) {
    return result("escalate", `Deal value ($${lead.deal_value.toLocaleString()}) exceeds threshold ($${(esc.dealValueThreshold ?? 5000).toLocaleString()})`, settings);
  }

  if (esc.vipAccount && lead.is_vip) {
    return result("escalate", "Contact is a VIP/key account", settings);
  }

  if (esc.cSuiteContact && lead.is_c_suite) {
    return result("escalate", "C-suite contact involved", settings);
  }

  if (
    esc.negativeSentiment &&
    decision.parameters.detected_sentiment === "negative"
  ) {
    return result("escalate", "Negative sentiment detected", settings);
  }

  if (esc.firstContact && lead.emails_sent === 0) {
    return result("escalate", "First contact with new lead", settings);
  }

  if (
    esc.pricingNegotiation &&
    decision.action_type === "draft_email" &&
    decision.parameters.involves_pricing
  ) {
    return result("escalate", "Pricing negotiation detected in email", settings);
  }

  // ── 2. request_info always allowed ──────────────────────────────────────
  if (decision.action_type === "request_info") {
    return { outcome: "request_info", reason: "Requesting information from user — always allowed" };
  }

  // ── 3. Global autonomy check ────────────────────────────────────────────
  if (settings.autonomyLevel === "draft_approve") {
    return { outcome: "await_approval", reason: "Global autonomy is Draft & Approve — all actions require approval" };
  }

  // ── 4. Per-action autonomy toggles ──────────────────────────────────────
  const toggles = settings.autonomyToggles;

  if (decision.action_type === "draft_email") {
    if (!toggles.sendFollowUps) {
      return { outcome: "await_approval", reason: "Follow-up email autonomy is disabled" };
    }
    if (decision.parameters.is_objection_response && !toggles.handleObjections) {
      return { outcome: "await_approval", reason: "Objection handling autonomy is disabled" };
    }
    if (decision.parameters.is_meeting_request && !toggles.bookMeetings) {
      return { outcome: "await_approval", reason: "Meeting booking autonomy is disabled" };
    }
  }

  if (decision.action_type === "book_meeting" && !toggles.bookMeetings) {
    return { outcome: "await_approval", reason: "Meeting booking autonomy is disabled" };
  }

  // ── 5. First outreach override ──────────────────────────────────────────
  if (
    toggles.firstOutreachApproval &&
    lead.emails_sent === 0 &&
    decision.action_type === "draft_email"
  ) {
    return { outcome: "await_approval", reason: "First outreach to this lead requires approval" };
  }

  // ── 6. Confidence threshold ─────────────────────────────────────────────
  if (decision.confidence_score < 0.5) {
    return result("escalate", `Confidence too low (${decision.confidence_score}) — needs human review`, settings);
  }
  if (decision.confidence_score < 0.7) {
    return { outcome: "await_approval", reason: `Moderate confidence (${decision.confidence_score}) — requesting approval` };
  }

  // ── 7. Output validation — banned phrases ───────────────────────────────
  if (
    decision.action_type === "draft_email" &&
    decision.parameters.email_content
  ) {
    const flagged = checkBannedPhrases(
      decision.parameters.email_content,
      settings.phrasesToNeverUse
    );
    if (flagged.length > 0) {
      return {
        outcome: "await_approval",
        reason: `Email contains banned phrase(s): ${flagged.map(p => `"${p}"`).join(", ")}`,
        flagged_phrases: flagged,
      };
    }

    // ── 7.5. Placeholder scan — catch fabrication markers ────────────────
    const scan = scanForPlaceholders(decision.parameters.email_content);
    if (scan.hasPlaceholders) {
      return {
        outcome: "request_info",
        reason: `Email contains placeholder/fabricated content: ${scan.placeholders.slice(0, 3).join(", ")}. Converting to info request.`,
      };
    }
  }

  // ── 8. All checks passed ───────────────────────────────────────────────
  return { outcome: "auto_execute", reason: "All guardrail checks passed" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build an escalation result with the channel resolved from Workflow Settings */
function result(
  outcome: "escalate",
  reason: string,
  settings: SkylerWorkflowSettings
): GuardrailResult {
  // Resolve escalation channel from user's notification config — NOT the AI's suggestion
  const notif = settings.notifications;
  let channel: "slack" | "email" | "task" = "slack"; // default
  if (notif.slack) channel = "slack";
  else if (notif.email) channel = "email";
  else if (notif.taskCreation) channel = "task";

  return { outcome, reason, escalation_channel: channel };
}

/** Case-insensitive check for banned phrases in content */
export function checkBannedPhrases(
  content: string,
  bannedPhrases: string[]
): string[] {
  if (!bannedPhrases || bannedPhrases.length === 0) return [];

  const lower = content.toLowerCase();
  return bannedPhrases.filter((phrase) => {
    const trimmed = phrase.trim();
    if (!trimmed) return false;
    return lower.includes(trimmed.toLowerCase());
  });
}

import { describe, it, expect } from "vitest";
import { checkGuardrails, checkBannedPhrases } from "./guardrail-engine";
import type { SkylerDecision } from "./decision-schema";
import type { SkylerWorkflowSettings } from "@/app/api/skyler/workflow-settings/route";
import type { GuardrailLeadContext } from "./guardrail-engine";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<SkylerDecision> = {}): SkylerDecision {
  return {
    action_type: "draft_email",
    parameters: {
      email_content: "Hi, I wanted to follow up on our conversation.",
      email_subject: "Following up",
    },
    reasoning: "Lead hasn't responded in 3 days",
    confidence_score: 0.85,
    urgency: "standard",
    ...overrides,
  };
}

function makeSettings(overrides: Partial<SkylerWorkflowSettings> = {}): SkylerWorkflowSettings {
  return {
    autonomyLevel: "full_autonomy",
    scoringDimensions: [],
    routingRules: [],
    notifications: {
      slack: true,
      slackChannel: "#sales-alerts",
      email: false,
      emailAddress: "",
      taskCreation: false,
      taskAssignee: "",
    },
    escalationRules: {
      dealValueExceedsThreshold: true,
      dealValueThreshold: 5000,
      vipAccount: true,
      negativeSentiment: true,
      firstContact: true,
      cSuiteContact: true,
      pricingNegotiation: true,
    },
    primaryGoal: "Book demos",
    salesJourney: "",
    pricingStructure: "",
    averageSalesCycle: "1-3 months",
    averageDealSize: "$1K-$10K",
    formality: "Professional but friendly",
    communicationApproach: "Consultative",
    phrasesToAlwaysUse: [],
    phrasesToNeverUse: [],
    maxFollowUpAttempts: 4,
    bookDemosUsing: "Calendly link",
    autonomyToggles: {
      sendFollowUps: true,
      handleObjections: true,
      bookMeetings: true,
      firstOutreachApproval: true,
    },
    knowledgeGapHandling: "ask_first",
    defaultMeetingDuration: 30,
    preCallBriefEnabled: true,
    preCallBriefTiming: "30min",
    noShowFollowUp: "auto_draft",
    calendlyStageMapping: {},
    ...overrides,
  };
}

function makeLead(overrides: Partial<GuardrailLeadContext> = {}): GuardrailLeadContext {
  return {
    emails_sent: 3,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("checkGuardrails", () => {
  // ── 1. Escalation rules ──────────────────────────────────────────────────

  it("escalates when deal value exceeds threshold", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings(),
      makeLead({ deal_value: 10000 })
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("Deal value");
    expect(result.escalation_channel).toBe("slack");
  });

  it("does not escalate when deal value is below threshold", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings(),
      makeLead({ deal_value: 3000 })
    );
    expect(result.outcome).not.toBe("escalate");
  });

  it("escalates for VIP contacts", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings(),
      makeLead({ is_vip: true })
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("VIP");
  });

  it("escalates for C-suite contacts", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings(),
      makeLead({ is_c_suite: true })
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("C-suite");
  });

  it("escalates on negative sentiment", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "I understand your concerns...",
          detected_sentiment: "negative",
        },
      }),
      makeSettings(),
      makeLead()
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("sentiment");
  });

  it("escalates on first contact with new lead", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings(),
      makeLead({ emails_sent: 0 })
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("First contact");
  });

  it("escalates when pricing negotiation detected", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "We can offer a discount...",
          involves_pricing: true,
        },
      }),
      makeSettings(),
      makeLead()
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("Pricing");
  });

  it("resolves escalation channel from settings (email)", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings({
        notifications: {
          slack: false,
          slackChannel: "",
          email: true,
          emailAddress: "boss@company.com",
          taskCreation: false,
          taskAssignee: "",
        },
      }),
      makeLead({ is_vip: true })
    );
    expect(result.outcome).toBe("escalate");
    expect(result.escalation_channel).toBe("email");
  });

  // ── 2. request_info always allowed ───────────────────────────────────────

  it("allows request_info regardless of settings", () => {
    const result = checkGuardrails(
      makeDecision({
        action_type: "request_info",
        parameters: { request_description: "What's the budget?" },
      }),
      makeSettings({ autonomyLevel: "draft_approve" }),
      makeLead()
    );
    expect(result.outcome).toBe("request_info");
  });

  // ── 3. Global autonomy: Draft & Approve ──────────────────────────────────

  it("blocks everything in Draft & Approve mode", () => {
    const result = checkGuardrails(
      makeDecision({ confidence_score: 0.99 }),
      makeSettings({ autonomyLevel: "draft_approve" }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("Draft & Approve");
  });

  // ── 4. Per-action autonomy toggles ───────────────────────────────────────

  it("blocks follow-up email when toggle is off", () => {
    const result = checkGuardrails(
      makeDecision(),
      makeSettings({
        autonomyToggles: {
          sendFollowUps: false,
          handleObjections: true,
          bookMeetings: true,
          firstOutreachApproval: false,
        },
      }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("Follow-up email autonomy");
  });

  it("blocks objection handling when toggle is off", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "I hear your concern...",
          is_objection_response: true,
        },
      }),
      makeSettings({
        autonomyToggles: {
          sendFollowUps: true,
          handleObjections: false,
          bookMeetings: true,
          firstOutreachApproval: false,
        },
      }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("Objection handling");
  });

  it("blocks meeting booking when toggle is off", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "Let's schedule a meeting...",
          is_meeting_request: true,
        },
      }),
      makeSettings({
        autonomyToggles: {
          sendFollowUps: true,
          handleObjections: true,
          bookMeetings: false,
          firstOutreachApproval: false,
        },
      }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("Meeting booking");
  });

  // ── 5. First outreach override ───────────────────────────────────────────

  it("requires approval for first outreach when toggle is on", () => {
    // Disable the escalation first-contact rule so we reach the toggle check
    const result = checkGuardrails(
      makeDecision(),
      makeSettings({
        escalationRules: {
          dealValueExceedsThreshold: false,
          dealValueThreshold: 5000,
          vipAccount: false,
          negativeSentiment: false,
          firstContact: false, // disable escalation rule
          cSuiteContact: false,
          pricingNegotiation: false,
        },
        autonomyToggles: {
          sendFollowUps: true,
          handleObjections: true,
          bookMeetings: true,
          firstOutreachApproval: true,
        },
      }),
      makeLead({ emails_sent: 0 })
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("First outreach");
  });

  // ── 6. Confidence thresholds ─────────────────────────────────────────────

  it("escalates when confidence is below 0.5", () => {
    const result = checkGuardrails(
      makeDecision({ confidence_score: 0.3 }),
      makeSettings(),
      makeLead()
    );
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toContain("Confidence too low");
  });

  it("requires approval when confidence is between 0.5 and 0.7", () => {
    const result = checkGuardrails(
      makeDecision({ confidence_score: 0.6 }),
      makeSettings(),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("Moderate confidence");
  });

  // ── 7. Banned phrases ────────────────────────────────────────────────────

  it("flags email with banned phrases for approval", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "Just checking in to see if you had a chance to review our proposal.",
          email_subject: "Quick follow-up",
        },
      }),
      makeSettings({ phrasesToNeverUse: ["just checking in"] }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.reason).toContain("banned phrase");
    expect(result.flagged_phrases).toEqual(["just checking in"]);
  });

  it("catches banned phrases case-insensitively", () => {
    const result = checkGuardrails(
      makeDecision({
        parameters: {
          email_content: "JUST CHECKING IN on the proposal.",
        },
      }),
      makeSettings({ phrasesToNeverUse: ["just checking in"] }),
      makeLead()
    );
    expect(result.outcome).toBe("await_approval");
    expect(result.flagged_phrases).toEqual(["just checking in"]);
  });

  // ── 8. Full autonomy — all checks pass ───────────────────────────────────

  it("auto-executes when all checks pass", () => {
    const result = checkGuardrails(
      makeDecision({ confidence_score: 0.9 }),
      makeSettings({
        autonomyLevel: "full_autonomy",
        escalationRules: {
          dealValueExceedsThreshold: false,
          dealValueThreshold: 5000,
          vipAccount: false,
          negativeSentiment: false,
          firstContact: false,
          cSuiteContact: false,
          pricingNegotiation: false,
        },
        autonomyToggles: {
          sendFollowUps: true,
          handleObjections: true,
          bookMeetings: true,
          firstOutreachApproval: false,
        },
      }),
      makeLead({ emails_sent: 2 })
    );
    expect(result.outcome).toBe("auto_execute");
    expect(result.reason).toContain("All guardrail checks passed");
  });

  it("auto-executes non-email actions (like create_note) in full autonomy", () => {
    const result = checkGuardrails(
      makeDecision({
        action_type: "create_note",
        parameters: { note_text: "Great call — they're interested in the pro plan." },
        confidence_score: 0.9,
      }),
      makeSettings(),
      makeLead()
    );
    expect(result.outcome).toBe("auto_execute");
  });
});

// ── checkBannedPhrases unit tests ────────────────────────────────────────────

describe("checkBannedPhrases", () => {
  it("returns empty array when no banned phrases", () => {
    expect(checkBannedPhrases("Hello world", [])).toEqual([]);
  });

  it("finds a banned phrase", () => {
    expect(checkBannedPhrases("Just checking in on this", ["just checking in"])).toEqual(["just checking in"]);
  });

  it("is case insensitive", () => {
    expect(checkBannedPhrases("TOUCHING BASE with you", ["touching base"])).toEqual(["touching base"]);
  });

  it("finds multiple banned phrases", () => {
    const result = checkBannedPhrases(
      "Just checking in and touching base about synergies",
      ["just checking in", "touching base", "synergies"]
    );
    expect(result).toEqual(["just checking in", "touching base", "synergies"]);
  });

  it("skips empty/whitespace phrases", () => {
    expect(checkBannedPhrases("Hello world", ["", "  "])).toEqual([]);
  });
});

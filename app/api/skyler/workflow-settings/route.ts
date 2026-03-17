/**
 * GET / POST Skyler Workflow Settings.
 * Stored in workspaces.settings JSONB under the key "skyler_workflow".
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type ScoringDimension = {
  name: string;
  weight: number;
  description: string;
};

export type RoutingRule = {
  label: string;
  minScore: number;
  maxScore: number;
  description: string;
};

export type SkylerWorkflowSettings = {
  // Global
  autonomyLevel: "full_autonomy" | "draft_approve";

  // Lead Qualification
  scoringDimensions: ScoringDimension[];
  routingRules: RoutingRule[];
  notifications: {
    slack: boolean;
    slackChannel: string;
    email: boolean;
    emailAddress: string;
    taskCreation: boolean;
    taskAssignee: string;
  };
  escalationRules: {
    dealValueExceedsThreshold: boolean;
    dealValueThreshold: number;
    vipAccount: boolean;
    negativeSentiment: boolean;
    firstContact: boolean;
    cSuiteContact: boolean;
    pricingNegotiation: boolean;
  };

  // Sales Closer — Your Sales Process
  primaryGoal: string;
  salesJourney: string;
  pricingStructure: string;
  averageSalesCycle: string;
  averageDealSize: string;

  // Sales Closer — Communication Style
  formality: string;
  communicationApproach: string;
  phrasesToAlwaysUse: string[];
  phrasesToNeverUse: string[];

  // Sales Closer — Follow-up Behaviour
  maxFollowUpAttempts: number;
  bookDemosUsing: string;

  // Sales Closer — Autonomy Toggles
  autonomyToggles: {
    sendFollowUps: boolean;
    handleObjections: boolean;
    bookMeetings: boolean;
    firstOutreachApproval: boolean;
  };

  // Knowledge Gap Handling
  knowledgeGapHandling: "ask_first" | "draft_best_attempt";
};

export const DEFAULT_WORKFLOW_SETTINGS: SkylerWorkflowSettings = {
  autonomyLevel: "draft_approve",
  scoringDimensions: [
    { name: "Company Size", weight: 25, description: "50-1000 employees = highest score. Under 10 or over 5000 = penalty." },
    { name: "Tech Stack Match", weight: 30, description: "Matches on key technologies used by your ideal customer." },
    { name: "Intent Signals", weight: 30, description: "Buying intent indicators from web activity, content engagement." },
    { name: "Decision Maker Bonus", weight: 15, description: "Extra points for contacts with decision-making authority." },
  ],
  routingRules: [
    { label: "Hot Lead", minScore: 70, maxScore: 100, description: "Routed to rep queue immediately with full enrichment brief. High priority lead." },
    { label: "Nurture", minScore: 40, maxScore: 69, description: "Enters nurture sequence. 6-month automated email cadence with re-engagement attempts." },
    { label: "Low Priority", minScore: 0, maxScore: 39, description: "Flagged as low priority. Minimal follow-up, kept in database for future reference." },
  ],
  notifications: {
    slack: true,
    slackChannel: "#sales-alerts",
    email: true,
    emailAddress: "",
    taskCreation: true,
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
};

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  const workflow = (settings.skyler_workflow ?? DEFAULT_WORKFLOW_SETTINGS) as SkylerWorkflowSettings;
  const meetingSettings = (settings.skyler_meeting ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    settings: { ...DEFAULT_WORKFLOW_SETTINGS, ...workflow },
    meetingSettings: {
      autoJoinMeetings: meetingSettings.autoJoinMeetings ?? false,
      botDisplayName: meetingSettings.botDisplayName ?? "",
      calendarConnected: meetingSettings.calendarConnected ?? false,
      calendarProvider: meetingSettings.calendarProvider ?? "",
      calendarEmail: meetingSettings.calendarEmail ?? "",
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { workspaceId, settings: newSettings, meetingSettings: newMeetingSettings } = body as {
    workspaceId: string;
    settings: Partial<SkylerWorkflowSettings>;
    meetingSettings?: Record<string, unknown>;
  };

  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Read current settings
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;
  const currentWorkflow = (currentSettings.skyler_workflow ?? DEFAULT_WORKFLOW_SETTINGS) as SkylerWorkflowSettings;

  // Merge workflow settings
  const merged = { ...currentWorkflow, ...newSettings };

  // Merge meeting settings (stored under skyler_meeting key)
  const currentMeeting = (currentSettings.skyler_meeting ?? {}) as Record<string, unknown>;
  const mergedMeeting = newMeetingSettings
    ? { ...currentMeeting, ...newMeetingSettings }
    : currentMeeting;

  // Write back
  const { error } = await db
    .from("workspaces")
    .update({
      settings: { ...currentSettings, skyler_workflow: merged, skyler_meeting: mergedMeeting },
    })
    .eq("id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settings: merged });
}

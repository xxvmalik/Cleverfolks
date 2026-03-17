/**
 * Context Assembler for Skyler's reasoning engine.
 *
 * Gathers all context needed for a reasoning call: workflow settings,
 * pipeline record, conversation history, workspace memories, and sender identity.
 * Kept separate from the reasoning function for testability.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  type SkylerWorkflowSettings,
  DEFAULT_WORKFLOW_SETTINGS,
} from "@/app/api/skyler/workflow-settings/route";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";
import { getActiveDirectives, type Directive } from "@/lib/skyler/directives/directive-store";
import { getLeadMeetingContext } from "@/lib/skyler/meetings/meeting-search";
import {
  getMemories,
  formatMemoriesForPrompt,
  type AgentMemory,
} from "@/lib/skyler/memory/agent-memory-store";
import {
  getActiveCorrections,
  formatCorrectionsForPrompt,
  type AgentCorrection,
} from "@/lib/skyler/learning/correction-store";
import {
  getGoldenExamples,
  formatGoldenExamplesForPrompt,
  type GoldenExample,
} from "@/lib/skyler/learning/golden-examples";
import {
  getDimensions,
  formatDimensionsForPrompt,
  type BehaviouralDimension,
} from "@/lib/skyler/learning/behavioural-dimensions";
import {
  getConfidence,
  formatConfidenceForPrompt,
  inferTrackedTaskType,
  type ConfidenceRecord,
} from "@/lib/skyler/learning/confidence-tracking";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReasoningEvent = {
  type:
    | "lead.qualified.hot"
    | "lead.reply.received"
    | "cadence.followup.due"
    | "meeting.booked"
    | "meeting.transcript.ready"
    | "user.directive"
    | "user.response";
  data: Record<string, unknown>;
};

export type PipelineRecord = {
  id: string;
  workspace_id: string;
  contact_id: string;
  contact_email: string;
  contact_name: string;
  company_name: string;
  company_id?: string;
  stage: string;
  emails_sent: number;
  emails_replied: number;
  emails_opened: number;
  lead_score?: number;
  resolution?: string;
  awaiting_reply: boolean;
  conversation_thread: Array<{
    role: string;
    content: string;
    subject?: string;
    timestamp: string;
    status?: string;
  }>;
  meeting_outcome?: string;
  meeting_transcript?: string;
  action_notes?: Array<{
    text: string;
    deadline?: string;
    completed?: boolean;
  }>;
  deal_value?: number;
  is_vip?: boolean;
  is_c_suite?: boolean;
  created_at: string;
};

export type SenderIdentity = {
  ownerName: string | null;
  companyName: string;
};

export type ReasoningContext = {
  event: ReasoningEvent;
  workflowSettings: SkylerWorkflowSettings;
  pipeline: PipelineRecord;
  memories: string[];
  sender: SenderIdentity;
  directives: Directive[];
  pendingRequests: Array<{ id: string; request_description: string; created_at: string }>;
  agentMemories: AgentMemory[];
  meetingContext: {
    hasMeetings: boolean;
    meetingCount: number;
    latestMeeting: {
      id: string;
      meetingDate: string;
      summary: string | null;
      intelligence: Record<string, unknown> | null;
      participants: Array<{ name: string }> | null;
    } | null;
  } | null;
  // Stage 11: Learning context
  corrections: AgentCorrection[];
  goldenExamples: GoldenExample[];
  behaviouralDimensions: BehaviouralDimension[];
  confidenceRecord: ConfidenceRecord | null;
};

// ── Context assembly ─────────────────────────────────────────────────────────

export async function assembleReasoningContext(
  event: ReasoningEvent,
  workspaceId: string,
  pipelineId: string
): Promise<ReasoningContext> {
  const db = createAdminSupabaseClient();

  // Load everything in parallel
  const [workspaceResult, pipelineResult, memoriesResult, directivesResult, requestsResult, meetingContextResult, agentMemoriesResult, correctionsResult, dimensionsResult] = await Promise.all([
    // Workspace settings + sender identity
    db
      .from("workspaces")
      .select("name, settings")
      .eq("id", workspaceId)
      .single(),

    // Pipeline record
    db
      .from("skyler_sales_pipeline")
      .select("*")
      .eq("id", pipelineId)
      .single(),

    // Workspace memories
    db
      .from("workspace_memories")
      .select("content")
      .eq("workspace_id", workspaceId)
      .is("superseded_by", null)
      .order("times_reinforced", { ascending: false })
      .limit(20),

    // Active directives for this lead
    getActiveDirectives(db, pipelineId),

    // Pending info requests for this lead
    db
      .from("skyler_requests")
      .select("id, request_description, created_at")
      .eq("pipeline_id", pipelineId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),

    // Meeting intelligence for this lead
    getLeadMeetingContext(pipelineId),

    // Permanent agent memories (workspace-level + lead-level)
    getMemories(db, workspaceId, pipelineId),

    // Stage 11: Learning data
    getActiveCorrections(db, workspaceId, { leadId: pipelineId, limit: 10 }),
    getDimensions(db, workspaceId),
  ]);

  // Extract workflow settings
  const wsSettings = (workspaceResult.data?.settings ?? {}) as Record<
    string,
    unknown
  >;
  const rawWorkflow = wsSettings.skyler_workflow as
    | SkylerWorkflowSettings
    | undefined;
  const workflowSettings: SkylerWorkflowSettings = rawWorkflow
    ? { ...DEFAULT_WORKFLOW_SETTINGS, ...rawWorkflow }
    : DEFAULT_WORKFLOW_SETTINGS;

  // Pipeline record
  if (!pipelineResult.data) {
    throw new Error(`Pipeline record ${pipelineId} not found`);
  }
  const pipeline = pipelineResult.data as unknown as PipelineRecord;

  // Stage 11: Load golden examples + confidence (depend on inferred task type)
  const inferredTaskType = inferTrackedTaskType("draft_email", { stage: pipeline.stage });
  const [goldenExamplesResult, confidenceResult] = await Promise.all([
    inferredTaskType ? getGoldenExamples(db, workspaceId, inferredTaskType, 3) : Promise.resolve([]),
    inferredTaskType ? getConfidence(db, workspaceId, inferredTaskType) : Promise.resolve(null),
  ]);

  // Memories (filtered for relevance)
  const rawMemories = (memoriesResult.data ?? []).map(
    (m) => m.content as string
  );
  const memories = filterDealMemories(rawMemories);

  // Sender identity
  const companyName =
    (wsSettings.company_name as string | undefined)?.trim() ||
    workspaceResult.data?.name?.trim() ||
    "your company";

  // Get owner name
  const { data: memberData } = await db
    .from("workspace_memberships")
    .select("profiles(full_name)")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = (memberData as any)?.profiles;
  const ownerName: string | null = Array.isArray(profile)
    ? profile[0]?.full_name ?? null
    : profile?.full_name ?? null;

  return {
    event,
    workflowSettings,
    pipeline,
    memories,
    sender: { ownerName, companyName },
    directives: directivesResult,
    pendingRequests: (requestsResult.data ?? []) as Array<{ id: string; request_description: string; created_at: string }>,
    agentMemories: agentMemoriesResult,
    meetingContext: meetingContextResult,
    corrections: correctionsResult,
    goldenExamples: goldenExamplesResult as GoldenExample[],
    behaviouralDimensions: dimensionsResult,
    confidenceRecord: confidenceResult as ConfidenceRecord | null,
  };
}

// ── Format context into a reasoning prompt ───────────────────────────────────

export function formatReasoningPrompt(ctx: ReasoningContext): string {
  const { event, workflowSettings: ws, pipeline: p, memories, sender, directives, pendingRequests, meetingContext, agentMemories, corrections, goldenExamples, behaviouralDimensions, confidenceRecord } = ctx;

  // Event description
  const eventDescription = formatEventDescription(event);

  // Conversation thread (last 10 messages)
  const thread = (p.conversation_thread ?? []).slice(-10);
  const threadBlock =
    thread.length > 0
      ? thread
          .map(
            (e) =>
              `[${e.role}]${e.subject ? ` Subject: "${e.subject}"` : ""} (${e.timestamp}):\n${e.content}`
          )
          .join("\n\n")
      : "(No conversation history yet)";

  // Meeting context — use structured intelligence if available, fall back to legacy
  let meetingBlock = "";
  if (meetingContext?.hasMeetings && meetingContext.latestMeeting) {
    const m = meetingContext.latestMeeting;
    const intel = m.intelligence ?? {};
    const participants = (m.participants ?? []).map((p) => p.name).join(", ");

    meetingBlock = `\n## Recent Meeting with This Lead
- Date: ${m.meetingDate ? new Date(m.meetingDate).toLocaleDateString() : "unknown"}
- Participants: ${participants || "unknown"}
${m.summary ? `- Summary: ${m.summary}` : ""}
${(intel.action_items as string[] | undefined)?.length ? `- Action items: ${(intel.action_items as string[]).join("; ")}` : ""}
${(intel.commitments as string[] | undefined)?.length ? `- Commitments made: ${(intel.commitments as string[]).join("; ")}` : ""}
${(intel.stakeholders_identified as string[] | undefined)?.length ? `- Stakeholders identified: ${(intel.stakeholders_identified as string[]).join(", ")}` : ""}
${(intel.objections as string[] | undefined)?.length ? `- Their objections: ${(intel.objections as string[]).join("; ")}` : ""}
${(intel.pain_points as string[] | undefined)?.length ? `- Pain points: ${(intel.pain_points as string[]).join("; ")}` : ""}
${(intel.buying_signals as string[] | undefined)?.length ? `- Buying signals: ${(intel.buying_signals as string[]).join("; ")}` : ""}
${(intel.next_steps_discussed as string[] | undefined)?.length ? `- Next steps discussed: ${(intel.next_steps_discussed as string[]).join("; ")}` : ""}
${meetingContext.meetingCount > 1 ? `- (${meetingContext.meetingCount} total meetings on record)` : ""}`.replace(/\n{2,}/g, "\n");
  } else if (p.meeting_outcome || p.meeting_transcript) {
    // Legacy fallback
    meetingBlock = `\n## Meeting Data
- Outcome: ${p.meeting_outcome ?? "unknown"}
${p.meeting_transcript ? `- Transcript summary available (${p.meeting_transcript.length} chars)` : "- No transcript"}
${p.action_notes && p.action_notes.length > 0 ? `- Action items: ${p.action_notes.map((n) => n.text).join("; ")}` : ""}`;
  }

  // Business memories
  const memoryBlock =
    memories.length > 0
      ? memories.map((m) => `- ${m}`).join("\n")
      : "(No workspace memories available)";

  // Sales config summary
  const salesConfig = `- Primary goal: ${ws.primaryGoal || "Not set"}
- Formality: ${ws.formality || "Professional but friendly"}
- Approach: ${ws.communicationApproach || "Consultative"}
- Max follow-ups: ${ws.maxFollowUpAttempts ?? 4}
- Book demos using: ${ws.bookDemosUsing || "Not set"}${ws.phrasesToNeverUse.length > 0 ? `\n- NEVER use: ${ws.phrasesToNeverUse.map((p) => `"${p}"`).join(", ")}` : ""}${ws.phrasesToAlwaysUse.length > 0 ? `\n- Always use: ${ws.phrasesToAlwaysUse.map((p) => `"${p}"`).join(", ")}` : ""}`;

  return `## What Just Happened
${eventDescription}

## Lead Context
- Name: ${p.contact_name}
- Email: ${p.contact_email}
- Company: ${p.company_name}
- Pipeline Stage: ${p.stage}
- Emails Sent: ${p.emails_sent}, Opened: ${p.emails_opened ?? 0}, Replied: ${p.emails_replied ?? 0}
- Lead Score: ${p.lead_score ?? "not scored"}
- Resolution: ${p.resolution ?? "none (active)"}
- Awaiting Reply: ${p.awaiting_reply ? "Yes" : "No"}
- In Pipeline Since: ${p.created_at}
${p.deal_value != null ? `- Deal Value: $${p.deal_value.toLocaleString()}` : ""}
${meetingBlock}

## Conversation Thread
${threadBlock}

## Your Sales Configuration
${salesConfig}

## Business Context (Workspace Memories)
${memoryBlock}

## Sender
- From: ${sender.ownerName ?? "Sales Team"} at ${sender.companyName}
${directives.length > 0 ? `\n## User Instructions for This Lead\nThese are specific instructions from your human manager. Follow them.\n${directives.map((d) => `- "${d.directive_text}" (given on ${new Date(d.created_at).toLocaleDateString()})`).join("\n")}` : ""}
${pendingRequests.length > 0 ? `\n## Your Pending Info Requests\nYou previously asked the user for information. These are still unanswered:\n${pendingRequests.map((r) => `- ${r.request_description} (asked on ${new Date(r.created_at).toLocaleDateString()})`).join("\n")}` : ""}
${agentMemories.length > 0 ? `\n## What You Know About This Business\nThese are verified facts provided by the user. NEVER ask for information that is already listed here.\n${formatMemoriesForPrompt(agentMemories)}\n\nCRITICAL: If you need information NOT listed above, use request_info. Do NOT fabricate, guess, or use placeholders.` : "\n## What You Know About This Business\n(No stored facts yet. If you need specific business data — payment details, legal terms, pricing — use request_info to ask the user.)"}
${formatLearningContext(corrections, goldenExamples, behaviouralDimensions, confidenceRecord)}

## Your Task
Based on everything above, decide the single best action to take right now.

Available actions:
- draft_email: Compose an email to the lead (provide subject + content). Also use this for invoices/proposals — draft the invoice details as an email since invoicing tools aren't available yet.
- update_stage: Move the lead to a different pipeline stage (provide new_stage). Valid stages: initial_outreach, follow_up_1, follow_up_2, follow_up_3, replied, negotiation, demo_booked, meeting_booked, follow_up_meeting, proposal, closed_won, closed_lost
- schedule_followup: Schedule a follow-up for later (provide delay in hours + reason)
- create_note: Add a note to the lead record (provide note_text)
- request_info: Use this when you need specific business data that is NOT in your context — payment details, bank info, account numbers, pricing specifics, contract terms, delivery timelines, legal terms, technical specs, or ANY factual detail you weren't explicitly given. It is ALWAYS better to ask than to guess. Use this BEFORE generating placeholder values, brackets like [details here], or generic stand-ins. (provide request_description)
- escalate: Flag this for human attention (provide escalation_reason)
- do_nothing: No action needed right now (explain why in reasoning)
- close_won: Mark the deal as won (provide close_reason, won_amount)
- close_lost: Mark the deal as lost (provide close_reason, lost_reason)

For draft_email, also set these EXACT field names in parameters:
- email_subject: the email subject line
- email_content: the full email body ready to send
- is_objection_response: true if responding to an objection
- is_meeting_request: true if proposing/confirming a meeting
- involves_pricing: true if the email discusses pricing

Set detected_sentiment to "positive", "neutral", or "negative" based on the lead's latest message (if any).

Respond with ONLY valid JSON matching this EXACT format:
{
  "action_type": "draft_email",
  "parameters": {
    "email_subject": "...",
    "email_content": "...",
    "is_meeting_request": false,
    "is_objection_response": false,
    "involves_pricing": false,
    "detected_sentiment": "positive"
  },
  "reasoning": "Why you chose this action (1-2 sentences, shown to the user)",
  "confidence_score": 0.0-1.0,
  "urgency": "immediate" | "same_day" | "next_day" | "standard"
}`;
}

// ── Learning context formatter ───────────────────────────────────────────────

function formatLearningContext(
  corrections: AgentCorrection[],
  goldenExamples: GoldenExample[],
  dimensions: BehaviouralDimension[],
  confidence: ConfidenceRecord | null,
): string {
  const sections: string[] = [];

  const dimBlock = formatDimensionsForPrompt(dimensions);
  if (dimBlock) sections.push(dimBlock);

  const corrBlock = formatCorrectionsForPrompt(corrections);
  if (corrBlock) sections.push(corrBlock);

  const exBlock = formatGoldenExamplesForPrompt(goldenExamples);
  if (exBlock) sections.push(exBlock);

  if (confidence && confidence.total_decisions > 0) {
    const taskType = confidence.task_type.replace(/_/g, " ");
    sections.push(formatConfidenceForPrompt(confidence, taskType));
  }

  if (sections.length === 0) return "";
  return `\n## What You've Learned\n${sections.join("\n\n")}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDescription(event: ReasoningEvent): string {
  const d = event.data;
  switch (event.type) {
    case "lead.qualified.hot":
      return `A new lead has been qualified as HOT (score: ${d.leadScore ?? "unknown"}). This is their first time entering the pipeline. Research them and decide on the best first action.`;
    case "lead.reply.received":
      return `The lead just replied to our email. Their reply:\n"${(d.replyContent as string)?.slice(0, 2000) ?? "(no content)"}"`;
    case "cadence.followup.due":
      return `A scheduled follow-up is due for this lead. Follow-up #${d.followupNumber ?? "unknown"} of ${d.maxFollowups ?? "unknown"}. Time to decide: should we follow up again, change approach, or stop?`;
    case "meeting.booked":
      return `A meeting has been booked with this lead! Meeting details: ${d.meetingTitle ?? "untitled"} on ${d.meetingTime ?? "unknown time"}.`;
    case "meeting.transcript.ready":
      return `A meeting with this lead has concluded and the transcript is ready. Review the meeting data and decide on next steps.`;
    case "user.directive":
      return `The user has given you a specific instruction about this lead: "${d.directive ?? "(no directive)"}"`;
    case "user.response":
      return `You previously asked the user for information about this lead. They responded: "${d.response ?? "(no response)"}"`;
    default:
      return `Event: ${event.type}. Data: ${JSON.stringify(d).slice(0, 500)}`;
  }
}

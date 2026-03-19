/**
 * Decision Executor for Skyler's reasoning engine.
 *
 * Routes guardrail-approved decisions to the appropriate handler.
 * Reuses existing mechanisms: draftOutreachEmail (approval queue),
 * dispatchNotification (Slack/email/in-app), checkAndEscalate (escalation).
 *
 * Every execution is logged to skyler_decisions for audit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SkylerDecision } from "@/lib/skyler/reasoning/decision-schema";
import type { GuardrailResult } from "@/lib/skyler/reasoning/guardrail-engine";
import type { PipelineRecord } from "@/lib/skyler/reasoning/context-assembler";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { inngest } from "@/lib/inngest/client";
import { STAGES } from "@/lib/skyler/pipeline-stages";
import { validateAndLog, isValidTransition, getValidNextStages } from "@/lib/skyler/pipeline/state-machine";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExecutionContext = {
  db: SupabaseClient;
  workspaceId: string;
  pipeline: PipelineRecord;
  decision: SkylerDecision;
  guardrail: GuardrailResult;
  eventType: string;
};

export type ExecutionResult = {
  success: boolean;
  action: string;
  details?: string;
  actionId?: string;
  error?: string;
};

// ── Main router ──────────────────────────────────────────────────────────────

export async function executeDecision(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { decision, guardrail } = ctx;
  const logPrefix = `[execute-decision] ${ctx.pipeline.contact_name}:`;

  try {
    let result: ExecutionResult;

    switch (guardrail.outcome) {
      case "auto_execute":
        result = await executeAction(ctx);
        break;

      case "await_approval":
        result = await queueForApproval(ctx);
        break;

      case "request_info":
        result = await createInfoRequest(ctx);
        break;

      case "escalate":
        result = await handleEscalation(ctx);
        break;

      default:
        result = { success: false, action: "unknown", error: `Unknown guardrail outcome: ${guardrail.outcome}` };
    }

    // Log the decision for audit
    await logDecision(ctx, result);

    console.log(`${logPrefix} ${guardrail.outcome} → ${decision.action_type} → ${result.success ? "OK" : "FAILED"}`);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Execution failed:`, error);

    const result: ExecutionResult = { success: false, action: decision.action_type, error };
    await logDecision(ctx, result).catch(() => {});
    return result;
  }
}

// ── Action executors ─────────────────────────────────────────────────────────

async function executeAction(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { decision } = ctx;

  switch (decision.action_type) {
    case "draft_email":
      return await executeDraftEmail(ctx);
    case "update_stage":
      return await executeUpdateStage(ctx);
    case "schedule_followup":
      return await executeScheduleFollowup(ctx);
    case "create_note":
      return await executeCreateNote(ctx);
    case "close_won":
      return await executeCloseWon(ctx);
    case "close_lost":
      return await executeCloseLost(ctx);
    case "book_meeting":
      return await executeBookMeeting(ctx);
    case "do_nothing":
      return executeDoNothing(ctx);
    default:
      return { success: false, action: decision.action_type, error: `No executor for action: ${decision.action_type}` };
  }
}

// ── draft_email ──────────────────────────────────────────────────────────────

async function executeDraftEmail(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, workspaceId, pipeline, decision } = ctx;
  const params = decision.parameters;

  if (!params.email_content) {
    return { success: false, action: "draft_email", error: "No email_content in decision" };
  }

  // Store as pending action using existing mechanism (Approve/Reject UI)
  const { actionId } = await draftOutreachEmail(db, {
    workspaceId,
    pipelineId: pipeline.id,
    to: pipeline.contact_email,
    subject: params.email_subject ?? "Follow-up",
    htmlBody: params.email_content.replace(/\n/g, "<br>"),
    textBody: params.email_content,
  });

  // Notify
  await dispatchNotification(db, {
    workspaceId,
    eventType: "draft_awaiting_approval",
    pipelineId: pipeline.id,
    title: `Draft ready: ${pipeline.contact_name}`,
    body: `Skyler drafted a reply. Reasoning: ${decision.reasoning}`,
    metadata: {
      contactName: pipeline.contact_name,
      contactEmail: pipeline.contact_email,
      reasoning: decision.reasoning,
      confidence: decision.confidence_score,
    },
  });

  return { success: true, action: "draft_email", actionId, details: `Draft stored for ${pipeline.contact_email}` };
}

// ── update_stage ─────────────────────────────────────────────────────────────

async function executeUpdateStage(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, pipeline, decision } = ctx;
  const newStage = decision.parameters.new_stage;

  if (!newStage) {
    return { success: false, action: "update_stage", error: "No new_stage in decision" };
  }

  // FSM validation
  const check = await validateAndLog(
    pipeline.id,
    pipeline.stage,
    newStage,
    "reasoning_engine",
    `${ctx.eventType} → ${decision.action_type}`,
    { reasoning: decision.reasoning },
    decision.confidence_score
  );
  if (!check.valid) {
    return { success: false, action: "update_stage", error: check.reason };
  }

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update({ stage: newStage, updated_at: new Date().toISOString() })
    .eq("id", pipeline.id);

  if (error) return { success: false, action: "update_stage", error: error.message };

  return { success: true, action: "update_stage", details: `Stage updated: ${pipeline.stage} → ${newStage}` };
}

// ── schedule_followup ────────────────────────────────────────────────────────

async function executeScheduleFollowup(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, pipeline, decision } = ctx;
  const delayHours = decision.parameters.followup_delay_hours ?? 72;
  const reason = decision.parameters.followup_reason ?? "Scheduled follow-up";

  // Store the follow-up schedule on the pipeline record
  const followupAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update({
      next_followup_at: followupAt,
      awaiting_reply: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  if (error) return { success: false, action: "schedule_followup", error: error.message };

  return {
    success: true,
    action: "schedule_followup",
    details: `Follow-up scheduled in ${delayHours}h (${followupAt}). Reason: ${reason}`,
  };
}

// ── create_note ──────────────────────────────────────────────────────────────

async function executeCreateNote(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, pipeline, decision } = ctx;
  const noteText = decision.parameters.note_text;

  if (!noteText) {
    return { success: false, action: "create_note", error: "No note_text in decision" };
  }

  // Append to action_notes on the pipeline record
  const existingNotes = (pipeline.action_notes ?? []) as Array<Record<string, unknown>>;
  const newNote = {
    text: noteText,
    created_at: new Date().toISOString(),
    source: "reasoning_engine",
    completed: false,
  };

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update({
      action_notes: [...existingNotes, newNote],
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  if (error) return { success: false, action: "create_note", error: error.message };

  return { success: true, action: "create_note", details: `Note added: "${noteText.slice(0, 80)}..."` };
}

// ── close_won ────────────────────────────────────────────────────────────────

async function executeCloseWon(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, workspaceId, pipeline, decision } = ctx;

  // Log transition (close_won is valid from most engaged stages)
  await validateAndLog(
    pipeline.id,
    pipeline.stage,
    STAGES.CLOSED_WON,
    "reasoning_engine",
    `close_won: ${decision.reasoning}`,
    { reasoning: decision.reasoning, won_amount: decision.parameters.won_amount },
    decision.confidence_score
  );

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update({
      resolution: "won",
      stage: STAGES.CLOSED_WON,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  if (error) return { success: false, action: "close_won", error: error.message };

  await dispatchNotification(db, {
    workspaceId,
    eventType: "deal_closed_won",
    pipelineId: pipeline.id,
    title: `Deal won: ${pipeline.contact_name} at ${pipeline.company_name}`,
    body: decision.parameters.close_reason ?? "Deal closed successfully",
    metadata: {
      contactName: pipeline.contact_name,
      companyName: pipeline.company_name,
      wonAmount: decision.parameters.won_amount,
    },
  });

  return { success: true, action: "close_won", details: `Deal closed won${decision.parameters.won_amount ? ` ($${decision.parameters.won_amount.toLocaleString()})` : ""}` };
}

// ── close_lost ───────────────────────────────────────────────────────────────

async function executeCloseLost(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, workspaceId, pipeline, decision } = ctx;

  // Log transition
  await validateAndLog(
    pipeline.id,
    pipeline.stage,
    STAGES.CLOSED_LOST,
    "reasoning_engine",
    `close_lost: ${decision.parameters.lost_reason ?? decision.reasoning}`,
    { reasoning: decision.reasoning },
    decision.confidence_score
  );

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update({
      resolution: "lost",
      stage: STAGES.CLOSED_LOST,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  if (error) return { success: false, action: "close_lost", error: error.message };

  await dispatchNotification(db, {
    workspaceId,
    eventType: "deal_closed_lost",
    pipelineId: pipeline.id,
    title: `Deal lost: ${pipeline.contact_name} at ${pipeline.company_name}`,
    body: decision.parameters.lost_reason ?? decision.parameters.close_reason ?? "Deal closed lost",
    metadata: {
      contactName: pipeline.contact_name,
      companyName: pipeline.company_name,
      lostReason: decision.parameters.lost_reason,
    },
  });

  return { success: true, action: "close_lost", details: `Deal closed lost: ${decision.parameters.lost_reason ?? "no reason provided"}` };
}

// ── book_meeting ─────────────────────────────────────────────────────────────

async function executeBookMeeting(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { workspaceId, pipeline, decision } = ctx;
  const params = decision.parameters;

  // Emit booking request to Inngest — orchestrated by book-meeting-flow.ts
  await inngest.send({
    name: "skyler/meeting.book-requested",
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      leadEmail: pipeline.contact_email,
      leadName: pipeline.contact_name,
      companyName: pipeline.company_name,
      bookingMethodOverride: params.booking_method,
      suggestedDuration: params.meeting_duration_minutes,
      additionalAttendees: params.additional_attendees,
      calendlyEventType: params.calendly_event_type,
    },
  });

  return {
    success: true,
    action: "book_meeting",
    details: `Meeting booking flow triggered for ${pipeline.contact_name} (method: ${params.booking_method ?? "auto"})`,
  };
}

// ── do_nothing ───────────────────────────────────────────────────────────────

function executeDoNothing(ctx: ExecutionContext): ExecutionResult {
  console.log(`[execute-decision] do_nothing for ${ctx.pipeline.contact_name}: ${ctx.decision.reasoning}`);
  return { success: true, action: "do_nothing", details: ctx.decision.reasoning };
}

// ── Await approval (queue the decision) ──────────────────────────────────────

async function queueForApproval(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { decision } = ctx;

  // For email decisions, use the existing draft approval mechanism
  if (decision.action_type === "draft_email") {
    return await executeDraftEmail(ctx);
  }

  // For non-email decisions, store as a pending skyler_action
  const { db, workspaceId, pipeline } = ctx;
  const description = `${formatActionDescription(decision)} — Reasoning: ${decision.reasoning}`;

  const { data, error } = await db
    .from("skyler_actions")
    .insert({
      workspace_id: workspaceId,
      pipeline_id: pipeline.id,
      tool_name: `reasoning_${decision.action_type}`,
      tool_input: {
        action_type: decision.action_type,
        parameters: decision.parameters,
        reasoning: decision.reasoning,
        confidence_score: decision.confidence_score,
      },
      description,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) return { success: false, action: decision.action_type, error: error.message };

  await dispatchNotification(db, {
    workspaceId,
    eventType: "draft_awaiting_approval",
    pipelineId: pipeline.id,
    title: `Action pending: ${pipeline.contact_name}`,
    body: description,
    metadata: {
      actionType: decision.action_type,
      reasoning: decision.reasoning,
      confidence: decision.confidence_score,
    },
  });

  return {
    success: true,
    action: decision.action_type,
    actionId: data?.id,
    details: `Queued for approval: ${description}`,
  };
}

// ── Request info ─────────────────────────────────────────────────────────────

async function createInfoRequest(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, workspaceId, pipeline, decision } = ctx;
  const requestDescription = decision.parameters.request_description ?? "Skyler needs more information about this lead.";

  // Store in skyler_requests table
  const { data, error } = await db
    .from("skyler_requests")
    .insert({
      workspace_id: workspaceId,
      pipeline_id: pipeline.id,
      request_description: requestDescription,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) return { success: false, action: "request_info", error: error.message };

  // Also set a skyler_note on the pipeline so the banner appears on the lead card
  await db
    .from("skyler_sales_pipeline")
    .update({
      skyler_note: {
        type: "action_required",
        message: requestDescription,
        created_at: new Date().toISOString(),
        resolved: false,
        request_id: data?.id,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  // Notify the user — uses info_requested event type so it fires even in Full Autonomy mode
  await dispatchNotification(db, {
    workspaceId,
    eventType: "info_requested",
    pipelineId: pipeline.id,
    title: `Skyler needs info: ${pipeline.contact_name}`,
    body: requestDescription,
    metadata: {
      requestDescription,
      reasoning: decision.reasoning,
      requestId: data?.id,
    },
  });

  return {
    success: true,
    action: "request_info",
    actionId: data?.id,
    details: `Info request created: ${requestDescription}`,
  };
}

// ── Escalation ───────────────────────────────────────────────────────────────

async function handleEscalation(ctx: ExecutionContext): Promise<ExecutionResult> {
  const { db, workspaceId, pipeline, decision, guardrail } = ctx;
  const reason = guardrail.reason;

  // Flag pipeline record as escalated + pause cadence
  await db
    .from("skyler_sales_pipeline")
    .update({
      escalated: true,
      escalation_reasons: [reason],
      escalated_at: new Date().toISOString(),
      cadence_paused: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pipeline.id);

  // Dispatch notification using the channel from guardrail (resolved from Workflow Settings)
  await dispatchNotification(db, {
    workspaceId,
    eventType: "escalation_triggered",
    pipelineId: pipeline.id,
    title: `Escalation: ${pipeline.contact_name} at ${pipeline.company_name}`,
    body: `Reason: ${reason}. Skyler wanted to: ${decision.action_type}. Her reasoning: ${decision.reasoning}`,
    metadata: {
      contactName: pipeline.contact_name,
      contactEmail: pipeline.contact_email,
      companyName: pipeline.company_name,
      escalationReason: reason,
      suggestedAction: decision.action_type,
      aiReasoning: decision.reasoning,
      confidence: decision.confidence_score,
      escalationChannel: guardrail.escalation_channel,
    },
  });

  return {
    success: true,
    action: "escalate",
    details: `Escalated: ${reason}. Suggested action was: ${decision.action_type}`,
  };
}

// ── Decision audit log ───────────────────────────────────────────────────────

async function logDecision(ctx: ExecutionContext, result: ExecutionResult): Promise<void> {
  // Fire-and-forget CRM logging for every successful decision
  if (result.success) {
    emitCRMLog(ctx, result).catch(() => {});
  }

  try {
    await ctx.db.from("skyler_decisions").insert({
      workspace_id: ctx.workspaceId,
      pipeline_id: ctx.pipeline.id,
      event_type: ctx.eventType,
      decision: {
        action_type: ctx.decision.action_type,
        parameters: ctx.decision.parameters,
        reasoning: ctx.decision.reasoning,
        confidence_score: ctx.decision.confidence_score,
        urgency: ctx.decision.urgency,
      },
      guardrail_outcome: ctx.guardrail.outcome,
      guardrail_reason: ctx.guardrail.reason,
      execution_result: {
        success: result.success,
        action: result.action,
        details: result.details,
        error: result.error,
      },
    });
  } catch (err) {
    // Audit logging should never block execution
    console.error("[execute-decision] Failed to log decision:", err instanceof Error ? err.message : err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Emit CRM activity log for every executed decision */
async function emitCRMLog(ctx: ExecutionContext, result: ExecutionResult): Promise<void> {
  const activityMap: Record<string, string> = {
    draft_email: "email_sent",
    update_stage: "stage_changed",
    close_won: "stage_changed",
    close_lost: "stage_changed",
    book_meeting: "meeting_booked",
    escalate: "escalation_logged",
  };

  const activityType = activityMap[ctx.decision.action_type];
  if (!activityType) return;

  await inngest.send({
    name: "skyler/crm.log-activity",
    data: {
      workspace_id: ctx.workspaceId,
      lead_id: ctx.pipeline.id,
      activity_type: activityType,
      payload: {
        action_type: ctx.decision.action_type,
        reasoning: ctx.decision.reasoning,
        details: result.details,
        confidence: ctx.decision.confidence_score,
      },
    },
  });
}

function formatActionDescription(decision: SkylerDecision): string {
  switch (decision.action_type) {
    case "draft_email":
      return `Draft email: "${decision.parameters.email_subject ?? "Follow-up"}"`;
    case "update_stage":
      return `Update stage to: ${decision.parameters.new_stage}`;
    case "schedule_followup":
      return `Schedule follow-up in ${decision.parameters.followup_delay_hours ?? 72}h`;
    case "create_note":
      return `Add note: "${(decision.parameters.note_text ?? "").slice(0, 60)}..."`;
    case "close_won":
      return `Close deal as WON${decision.parameters.won_amount ? ` ($${decision.parameters.won_amount.toLocaleString()})` : ""}`;
    case "close_lost":
      return `Close deal as LOST: ${decision.parameters.lost_reason ?? "no reason"}`;
    case "escalate":
      return `Escalate: ${decision.parameters.escalation_reason ?? "needs attention"}`;
    case "request_info":
      return `Request info: ${decision.parameters.request_description ?? "needs information"}`;
    case "book_meeting":
      return `Book meeting (${decision.parameters.booking_method ?? "auto"})`;
    case "do_nothing":
      return "No action needed";
    default:
      return decision.action_type;
  }
}

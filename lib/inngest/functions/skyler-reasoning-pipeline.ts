/**
 * Skyler Reasoning Pipeline — Inngest Orchestration (Stage 6)
 *
 * Wires together the reasoning engine, guardrail engine, and decision executor
 * as durable Inngest functions. Runs ALONGSIDE the existing pipeline — does not
 * replace it. Events use "skyler/reasoning.*" namespace to avoid conflicts.
 *
 * Three functions:
 * 1. reasoningPipeline — Main handler: reason → guardrail → execute/queue
 * 2. reasoningCadenceScheduler — Fires follow-up events into the reasoning pipeline
 * 3. (Approval handled by existing approve/reject endpoints — no new function needed)
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { reasonAboutEvent } from "@/lib/skyler/reasoning/skyler-reasoning";
import { checkGuardrails } from "@/lib/skyler/reasoning/guardrail-engine";
import {
  executeDecision,
  type ExecutionContext,
} from "@/lib/skyler/actions/execute-decision";
import {
  assembleReasoningContext,
  type ReasoningEvent,
} from "@/lib/skyler/reasoning/context-assembler";
import { inferTaskType, checkKnowledge } from "@/lib/skyler/reasoning/knowledge-checker";
import { scanForPlaceholders } from "@/lib/skyler/reasoning/output-validator";

// ── Event Normalizer ─────────────────────────────────────────────────────────
// Maps old event shapes to the reasoning pipeline's expected format.

function normalizeEventData(
  eventName: string,
  data: Record<string, unknown>
): {
  pipelineId: string;
  workspaceId: string;
  eventType: ReasoningEvent["type"];
  eventData: Record<string, unknown>;
} {
  // Old pipeline events use flat data shapes — normalize them
  if (eventName === "skyler/lead.qualified.hot") {
    return {
      pipelineId: data.pipelineId as string,
      workspaceId: data.workspaceId as string,
      eventType: "lead.qualified.hot",
      eventData: {
        contactEmail: data.contactEmail,
        contactName: data.contactName,
        companyName: data.companyName,
        leadScore: data.leadScoreId,
      },
    };
  }

  if (eventName === "skyler/pipeline.reply.received") {
    return {
      pipelineId: data.pipelineId as string,
      workspaceId: data.workspaceId as string,
      eventType: "lead.reply.received",
      eventData: {
        replyContent: data.replyContent,
        contactEmail: data.contactEmail,
        stage: data.stage,
      },
    };
  }

  // Reasoning-namespaced events already have the correct shape
  return {
    pipelineId: data.pipelineId as string,
    workspaceId: data.workspaceId as string,
    eventType: data.eventType as ReasoningEvent["type"],
    eventData: (data.eventData as Record<string, unknown>) ?? {},
  };
}

// ── 1. Main Reasoning Pipeline ───────────────────────────────────────────────
// Triggered by reasoning-specific events AND bridged from existing events.
// reason → guardrail check → execute/queue/escalate

export const reasoningPipeline = inngest.createFunction(
  {
    id: "skyler-reasoning-pipeline",
    retries: 2,
  },
  [
    { event: "skyler/reasoning.reply-received" },
    { event: "skyler/reasoning.followup-due" },
    { event: "skyler/reasoning.meeting-booked" },
    { event: "skyler/reasoning.transcript-ready" },
    { event: "skyler/reasoning.user-directive" },
    { event: "skyler/reasoning.user-response" },
    { event: "skyler/reasoning.lead-qualified" },
    // Bridge events — also listen to existing pipeline events so both
    // the old pipeline and the reasoning engine process them in parallel
    { event: "skyler/lead.qualified.hot" },
    { event: "skyler/pipeline.reply.received" },
  ],
  async ({ event, step }) => {
    // Normalize event data — bridge old event shapes to reasoning format
    const normalized = normalizeEventData(event.name, event.data as Record<string, unknown>);

    const { pipelineId, workspaceId, eventType, eventData } = normalized;

    if (!pipelineId || !workspaceId) {
      console.warn(`[reasoning-pipeline] Missing pipelineId or workspaceId for event ${event.name}`);
      return { status: "skipped", reason: "missing_ids" };
    }

    console.log(`[reasoning-pipeline] Starting: ${eventType} for pipeline ${pipelineId}`);

    // Step 0: Pre-generation knowledge check (deterministic, no AI)
    // If critical data is missing, short-circuit before calling Claude → saves API cost
    const knowledgeGap = await step.run("knowledge-check", async () => {
      const taskType = inferTaskType(eventType, eventData);
      if (!taskType) return null;

      const ctx = await assembleReasoningContext(
        { type: eventType, data: eventData },
        workspaceId,
        pipelineId
      );
      const check = checkKnowledge(taskType, ctx.pipeline, ctx.workflowSettings, ctx.agentMemories);

      if (!check.isComplete) {
        console.log(`[reasoning-pipeline] Knowledge gap detected for ${taskType}: ${check.missingFields.join(", ")}`);
        return {
          action_type: "request_info" as const,
          parameters: {
            request_description: check.requestDescription,
          },
          reasoning: `Missing required data for ${taskType}: ${check.missingFields.join(", ")}. Asking user rather than fabricating.`,
          confidence_score: 1.0,
          urgency: "same_day" as const,
        };
      }

      return null;
    });

    // If knowledge check found gaps, skip reasoning entirely
    if (knowledgeGap) {
      console.log(`[reasoning-pipeline] Short-circuited: knowledge gap → request_info`);

      const executionResult = await step.run("execute-knowledge-gap", async () => {
        const db = createAdminSupabaseClient();
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", pipelineId)
          .single();

        if (!pipeline) throw new Error(`Pipeline record ${pipelineId} not found`);

        const execCtx: ExecutionContext = {
          db,
          workspaceId,
          pipeline: pipeline as unknown as ExecutionContext["pipeline"],
          decision: knowledgeGap,
          guardrail: { outcome: "request_info", reason: "Pre-generation knowledge check failed" },
          eventType,
        };
        return await executeDecision(execCtx);
      });

      return {
        pipelineId,
        eventType,
        decision: knowledgeGap,
        guardrail: { outcome: "request_info", reason: "Pre-generation knowledge check" },
        execution: executionResult,
        short_circuited: true,
      };
    }

    // Step 1: Reason — call Claude Sonnet for a structured decision
    const reasoningResult = await step.run("reason", async () => {
      const reasoningEvent: ReasoningEvent = {
        type: eventType,
        data: eventData,
      };
      return await reasonAboutEvent(reasoningEvent, workspaceId, pipelineId);
    });

    let decision = reasoningResult.decision;

    // Step 1.5: Post-generation placeholder scan (Layer 5)
    // If the AI drafted content with placeholders, convert to request_info
    if (decision.action_type === "draft_email" && decision.parameters.email_content) {
      const scan = scanForPlaceholders(decision.parameters.email_content);
      if (scan.hasPlaceholders) {
        console.log(`[reasoning-pipeline] Placeholder detected in draft: ${scan.placeholders.join(", ")}`);
        decision = {
          action_type: "request_info",
          parameters: {
            request_description: scan.missingDescription,
          },
          reasoning: `Draft contained placeholder content (${scan.placeholders.length} markers found). Asking user for the actual details instead of sending placeholders.`,
          confidence_score: 1.0,
          urgency: "same_day",
        };
      }
    }
    console.log(
      `[reasoning-pipeline] Decision: ${decision.action_type} (confidence: ${decision.confidence_score}, fallback: ${reasoningResult.is_fallback})`
    );

    // Step 2: Guardrail check — pure logic, no AI
    const guardrailResult = await step.run("check-guardrails", async () => {
      const ctx = await assembleReasoningContext(
        { type: eventType, data: eventData },
        workspaceId,
        pipelineId
      );
      return checkGuardrails(decision, ctx.workflowSettings, {
        emails_sent: ctx.pipeline.emails_sent,
        deal_value: ctx.pipeline.deal_value,
        is_vip: ctx.pipeline.is_vip,
        is_c_suite: ctx.pipeline.is_c_suite,
      });
    });

    console.log(
      `[reasoning-pipeline] Guardrail: ${guardrailResult.outcome} — ${guardrailResult.reason}`
    );

    // Step 3: Execute based on guardrail outcome
    const executionResult = await step.run("execute", async () => {
      const db = createAdminSupabaseClient();

      // Re-fetch pipeline for execution (fresh data)
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("id", pipelineId)
        .single();

      if (!pipeline) {
        throw new Error(`Pipeline record ${pipelineId} not found`);
      }

      const execCtx: ExecutionContext = {
        db,
        workspaceId,
        pipeline: pipeline as unknown as ExecutionContext["pipeline"],
        decision,
        guardrail: guardrailResult,
        eventType,
      };

      return await executeDecision(execCtx);
    });

    console.log(
      `[reasoning-pipeline] Execution: ${executionResult.success ? "SUCCESS" : "FAILED"} — ${executionResult.details ?? executionResult.error}`
    );

    // Step 4: If request_info, wait for user response then re-run reasoning
    if (
      decision.action_type === "request_info" &&
      executionResult.success
    ) {
      const userResponse = await step.waitForEvent("wait-for-user-response", {
        event: "skyler/reasoning.user-response",
        match: "data.pipelineId",
        timeout: "7d",
      });

      if (userResponse) {
        // User responded — fire a new reasoning event with the response
        await step.sendEvent("resume-with-response", {
          name: "skyler/reasoning.user-response",
          data: {
            pipelineId,
            workspaceId,
            eventType: "user.response" as const,
            eventData: {
              response: userResponse.data.eventData?.response ?? "",
              originalRequest: executionResult.details,
            },
          },
        });
      }
      // If timeout, the request stays pending — user can still respond later
    }

    // Step 5: If schedule_followup was executed, schedule the next event
    if (
      decision.action_type === "schedule_followup" &&
      executionResult.success &&
      guardrailResult.outcome === "auto_execute"
    ) {
      const delayHours = decision.parameters.followup_delay_hours ?? 72;
      const delayMs = delayHours * 60 * 60 * 1000;
      const delayStr = `${delayHours}h`;

      await step.sleep("wait-for-followup", delayStr);

      await step.sendEvent("fire-followup", {
        name: "skyler/reasoning.followup-due",
        data: {
          pipelineId,
          workspaceId,
          eventType: "cadence.followup.due" as const,
          eventData: {
            followupNumber: ((eventData.followupNumber as number) ?? 0) + 1,
            maxFollowups: eventData.maxFollowups ?? 4,
          },
        },
      });
    }

    return {
      pipelineId,
      eventType,
      decision: {
        action_type: decision.action_type,
        confidence: decision.confidence_score,
        urgency: decision.urgency,
        reasoning: decision.reasoning,
      },
      guardrail: {
        outcome: guardrailResult.outcome,
        reason: guardrailResult.reason,
      },
      execution: {
        success: executionResult.success,
        action: executionResult.action,
        details: executionResult.details,
        actionId: executionResult.actionId,
      },
      duration_ms: reasoningResult.duration_ms,
      is_fallback: reasoningResult.is_fallback,
    };
  }
);

// ── 2. Reasoning Cadence Scheduler ───────────────────────────────────────────
// Cron that finds due follow-ups and fires them into the reasoning pipeline
// instead of the old rule-based cadence. Runs alongside the existing scheduler.

export const reasoningCadenceScheduler = inngest.createFunction(
  {
    id: "skyler-reasoning-cadence-scheduler",
    retries: 1,
  },
  { cron: "0 * * * *" }, // Every hour, same as existing
  async ({ step }) => {
    const dueRecords = await step.run("find-due-followups", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();

      // Find pipeline records with reasoning_engine enabled and due for follow-up
      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .select(
          "id, workspace_id, contact_email, contact_name, company_name, cadence_step, stage"
        )
        .lte("next_followup_at", now)
        .is("resolution", null)
        .eq("awaiting_reply", true)
        .neq("cadence_paused", true)
        .eq("use_reasoning_engine", true) // Only pick up leads opted into the new engine
        .limit(50);

      if (error) {
        console.error("[reasoning-cadence] Query error:", error.message);
        return [];
      }

      console.log(
        `[reasoning-cadence] Found ${data?.length ?? 0} reasoning-engine leads due for follow-up`
      );
      return data ?? [];
    });

    if (dueRecords.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "dispatch-reasoning-followups",
      dueRecords.map((r) => ({
        name: "skyler/reasoning.followup-due" as const,
        data: {
          pipelineId: r.id,
          workspaceId: r.workspace_id,
          eventType: "cadence.followup.due" as const,
          eventData: {
            contactEmail: r.contact_email,
            contactName: r.contact_name,
            companyName: r.company_name,
            followupNumber: (r.cadence_step ?? 0) + 1,
            maxFollowups: 4,
          },
        },
      }))
    );

    return { dispatched: dueRecords.length };
  }
);

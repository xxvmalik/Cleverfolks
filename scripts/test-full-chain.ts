/**
 * Full chain test: Reasoning → Guardrail → Executor
 * Picks a real lead, runs the full pipeline, creates a real draft in the DB.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-full-chain.ts
 */

import { createClient } from "@supabase/supabase-js";
import {
  assembleReasoningContext,
  formatReasoningPrompt,
  type ReasoningEvent,
} from "../lib/skyler/reasoning/context-assembler";
import { reasonAboutEvent } from "../lib/skyler/reasoning/skyler-reasoning";
import { checkGuardrails } from "../lib/skyler/reasoning/guardrail-engine";
import { executeDecision } from "../lib/skyler/actions/execute-decision";

import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  console.log("=".repeat(80));
  console.log("FULL CHAIN TEST: Reasoning → Guardrail → Executor");
  console.log("=".repeat(80));

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Pick a real lead
  const { data: leads, error } = await db
    .from("skyler_sales_pipeline")
    .select("id, workspace_id, contact_name, contact_email, company_name, stage, emails_sent, emails_replied, conversation_thread")
    .is("resolution", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !leads || leads.length === 0) {
    console.error("No active pipeline leads found:", error?.message);
    return;
  }

  console.log("\n📋 Available leads:");
  leads.forEach((l, i) => {
    const threadLen = (l.conversation_thread ?? []).length;
    console.log(`  ${i + 1}. ${l.contact_name} (${l.contact_email}) — ${l.company_name} — Stage: ${l.stage} — Emails: ${l.emails_sent} — Thread: ${threadLen} msgs`);
  });

  // Pick the first lead with conversation history
  const lead = leads.find(l => (l.conversation_thread?.length ?? 0) > 0) ?? leads[0];
  console.log(`\n✅ Selected: ${lead.contact_name} (${lead.contact_email})`);

  // 2. Create event
  const mockReply = "Hey, sounds interesting! What kind of results have you seen with fitness coaches? I'd love to see some numbers before we jump on a call.";
  const event: ReasoningEvent = {
    type: "lead.reply.received",
    data: { replyContent: mockReply, contactEmail: lead.contact_email },
  };
  console.log(`\n📨 Event: lead.reply.received — "${mockReply.slice(0, 80)}..."`);

  // ── STEP 1: Reasoning ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("STEP 1: REASONING (calling Claude Sonnet)");
  console.log("─".repeat(80));

  const reasoningResult = await reasonAboutEvent(event, lead.workspace_id, lead.id);
  const decision = reasoningResult.decision;

  console.log(`✅ Decision: ${decision.action_type}`);
  console.log(`   Confidence: ${decision.confidence_score}`);
  console.log(`   Urgency: ${decision.urgency}`);
  console.log(`   Reasoning: ${decision.reasoning}`);
  console.log(`   Duration: ${reasoningResult.duration_ms}ms`);
  console.log(`   Is fallback: ${reasoningResult.is_fallback}`);
  if (decision.parameters.email_subject) console.log(`   Subject: ${decision.parameters.email_subject}`);
  if (decision.parameters.email_content) {
    console.log(`   Email content:`);
    console.log(`   ${decision.parameters.email_content.replace(/\n/g, "\n   ")}`);
  }

  // ── STEP 2: Guardrail ─────────────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("STEP 2: GUARDRAIL CHECK");
  console.log("─".repeat(80));

  // Load context for guardrail
  const ctx = await assembleReasoningContext(event, lead.workspace_id, lead.id);
  const guardrailResult = checkGuardrails(
    decision,
    ctx.workflowSettings,
    {
      emails_sent: ctx.pipeline.emails_sent,
      deal_value: ctx.pipeline.deal_value,
      is_vip: ctx.pipeline.is_vip,
      is_c_suite: ctx.pipeline.is_c_suite,
    }
  );

  console.log(`✅ Outcome: ${guardrailResult.outcome}`);
  console.log(`   Reason: ${guardrailResult.reason}`);
  if (guardrailResult.escalation_channel) console.log(`   Escalation channel: ${guardrailResult.escalation_channel}`);
  if (guardrailResult.flagged_phrases) console.log(`   Flagged phrases: ${guardrailResult.flagged_phrases.join(", ")}`);

  // ── STEP 3: Executor ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("STEP 3: EXECUTING DECISION");
  console.log("─".repeat(80));

  const executionResult = await executeDecision({
    db,
    workspaceId: lead.workspace_id,
    pipeline: ctx.pipeline,
    decision,
    guardrail: guardrailResult,
    eventType: event.type,
  });

  console.log(`✅ Execution: ${executionResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`   Action: ${executionResult.action}`);
  console.log(`   Details: ${executionResult.details}`);
  if (executionResult.actionId) console.log(`   Action ID: ${executionResult.actionId}`);
  if (executionResult.error) console.log(`   Error: ${executionResult.error}`);

  // ── STEP 4: Verify audit log ──────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("STEP 4: VERIFYING AUDIT LOG");
  console.log("─".repeat(80));

  const { data: auditLog } = await db
    .from("skyler_decisions")
    .select("*")
    .eq("pipeline_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (auditLog) {
    console.log("✅ Audit log entry found:");
    console.log(`   ID: ${auditLog.id}`);
    console.log(`   Event type: ${auditLog.event_type}`);
    console.log(`   Decision: ${auditLog.decision?.action_type} (confidence: ${auditLog.decision?.confidence_score})`);
    console.log(`   Guardrail: ${auditLog.guardrail_outcome} — ${auditLog.guardrail_reason}`);
    console.log(`   Execution: ${auditLog.execution_result?.success ? "SUCCESS" : "FAILED"} — ${auditLog.execution_result?.details}`);
    console.log(`   Created: ${auditLog.created_at}`);
  } else {
    console.log("❌ No audit log entry found");
  }

  // ── STEP 5: Verify pending action (if draft was created) ──────────────
  if (executionResult.actionId) {
    console.log("\n" + "─".repeat(80));
    console.log("STEP 5: VERIFYING PENDING ACTION (for Approve/Reject UI)");
    console.log("─".repeat(80));

    const { data: action } = await db
      .from("skyler_actions")
      .select("id, status, tool_name, description, tool_input")
      .eq("id", executionResult.actionId)
      .single();

    if (action) {
      console.log("✅ Pending action found:");
      console.log(`   ID: ${action.id}`);
      console.log(`   Status: ${action.status}`);
      console.log(`   Tool: ${action.tool_name}`);
      console.log(`   Description: ${action.description}`);
      console.log(`   To: ${action.tool_input?.to}`);
      console.log(`   Subject: ${action.tool_input?.subject}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("FULL CHAIN COMPLETE");
  console.log("=".repeat(80));
  console.log(`Lead: ${lead.contact_name} (${lead.contact_email})`);
  console.log(`AI Decision: ${decision.action_type} (confidence: ${decision.confidence_score})`);
  console.log(`Guardrail: ${guardrailResult.outcome}`);
  console.log(`Execution: ${executionResult.success ? "SUCCESS" : "FAILED"}`);
  if (executionResult.actionId) {
    console.log(`\n👉 Check the lead card for ${lead.contact_name} in the Skyler UI — you should see the draft with Approve/Reject buttons.`);
    console.log(`👉 Check skyler_decisions table in Supabase — you should see the audit log entry.`);
  }
  console.log("=".repeat(80));
}

main().catch(console.error);

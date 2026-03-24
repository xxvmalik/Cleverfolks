/**
 * Test script for Skyler's reasoning engine.
 * Picks a real lead from the pipeline, runs reasonAboutEvent(), and logs everything.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-reasoning.ts
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  assembleReasoningContext,
  formatReasoningPrompt,
  type ReasoningEvent,
} from "../lib/skyler/reasoning/context-assembler";
import { SkylerDecisionSchema } from "../lib/skyler/reasoning/decision-schema";
import { checkGuardrails } from "../lib/skyler/reasoning/guardrail-engine";
import { parseAIJson } from "../lib/utils/parse-ai-json";

// ── Load env ─────────────────────────────────────────────────────────────────

import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(80));
  console.log("SKYLER REASONING ENGINE — LIVE TEST");
  console.log("=".repeat(80));

  // 1. Pick a real lead from the pipeline
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
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
    console.log(`  ${i + 1}. ${l.contact_name} (${l.contact_email}) — ${l.company_name} — Stage: ${l.stage} — Emails: ${l.emails_sent}`);
  });

  // Pick the first lead with some conversation history, or just the first
  const lead = leads.find(l => (l.conversation_thread?.length ?? 0) > 0) ?? leads[0];
  console.log(`\n✅ Selected: ${lead.contact_name} (${lead.contact_email})`);

  // 2. Create a mock "reply received" event
  const mockReply = "Hi, thanks for reaching out. I'm interested in learning more about your services. Can you share some case studies or examples of results you've achieved for similar companies?";

  const event: ReasoningEvent = {
    type: "lead.reply.received",
    data: {
      replyContent: mockReply,
      contactEmail: lead.contact_email,
    },
  };

  console.log(`\n📨 Mock event: lead.reply.received`);
  console.log(`   Reply content: "${mockReply.slice(0, 100)}..."`);

  // 3. Assemble context
  console.log("\n" + "─".repeat(80));
  console.log("STEP 1: ASSEMBLING CONTEXT");
  console.log("─".repeat(80));

  let ctx;
  try {
    ctx = await assembleReasoningContext(event, lead.workspace_id, lead.id);
    console.log(`✅ Context assembled successfully`);
    console.log(`   - Workflow settings: autonomy=${ctx.workflowSettings.autonomyLevel}, goal=${ctx.workflowSettings.primaryGoal}`);
    console.log(`   - Pipeline: stage=${ctx.pipeline.stage}, emails_sent=${ctx.pipeline.emails_sent}`);
    console.log(`   - Memories: ${ctx.memories.length} loaded`);
    console.log(`   - Sender: ${ctx.sender.ownerName ?? "unknown"} at ${ctx.sender.companyName}`);
  } catch (err) {
    console.error("❌ Context assembly failed:", err instanceof Error ? err.message : err);
    return;
  }

  // 4. Format the reasoning prompt
  console.log("\n" + "─".repeat(80));
  console.log("STEP 2: REASONING PROMPT (what Claude receives)");
  console.log("─".repeat(80));

  const userPrompt = formatReasoningPrompt(ctx);
  console.log(userPrompt);

  // 5. Call Claude Sonnet
  console.log("\n" + "─".repeat(80));
  console.log("STEP 3: CALLING CLAUDE SONNET");
  console.log("─".repeat(80));

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const start = Date.now();

  const systemPrompt = `You are Skyler, a Sales AI Employee. You are making a decision about what to do next for a lead in your sales pipeline.

You think like a sales professional. You are strategic, empathetic, and results-driven. You understand that timing, tone, and persistence matter in sales.

RULES:
- Pick ONE action. The best single action right now.
- Be specific in your reasoning — reference the actual context (lead name, what they said, where they are in the pipeline).
- For emails, write the FULL email content ready to send. Match the communication style configured in your settings.
- For follow-ups, choose a delay that makes sense given the context (don't follow up too aggressively or too passively).
- If you're not sure what to do, it's better to escalate than to take a bad action.
- Your confidence_score should reflect how certain you are: 0.9+ = very confident, 0.7-0.9 = confident, 0.5-0.7 = uncertain, <0.5 = you really need a human to look at this.

Respond with ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const duration = Date.now() - start;
    console.log(`✅ Claude responded in ${duration}ms (stop_reason: ${response.stop_reason})`);
    console.log(`   Input tokens: ${response.usage.input_tokens}, Output tokens: ${response.usage.output_tokens}`);

    // Extract text
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    console.log("\n📝 Raw Claude output:");
    console.log(text);

    // 6. Validate against schema
    console.log("\n" + "─".repeat(80));
    console.log("STEP 4: SCHEMA VALIDATION");
    console.log("─".repeat(80));

    const parsed = parseAIJson(text);
    const validation = SkylerDecisionSchema.safeParse(parsed);

    if (!validation.success) {
      console.error("❌ Schema validation FAILED:");
      validation.error.issues.forEach(issue => {
        console.error(`   ${issue.path.join(".")}: ${issue.message}`);
      });
      return;
    }

    const decision = validation.data;
    console.log("✅ Schema validation PASSED");
    console.log(`\n📊 DECISION:`);
    console.log(`   Action: ${decision.action_type}`);
    console.log(`   Confidence: ${decision.confidence_score}`);
    console.log(`   Urgency: ${decision.urgency}`);
    console.log(`   Reasoning: ${decision.reasoning}`);
    if (decision.parameters.email_subject) console.log(`   Email Subject: ${decision.parameters.email_subject}`);
    if (decision.parameters.email_content) console.log(`   Email Content:\n${decision.parameters.email_content}`);
    if (decision.parameters.detected_sentiment) console.log(`   Detected Sentiment: ${decision.parameters.detected_sentiment}`);

    // 7. Run through guardrail engine
    console.log("\n" + "─".repeat(80));
    console.log("STEP 5: GUARDRAIL ENGINE CHECK");
    console.log("─".repeat(80));

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

    console.log(`   Outcome: ${guardrailResult.outcome}`);
    console.log(`   Reason: ${guardrailResult.reason}`);
    if (guardrailResult.escalation_channel) console.log(`   Escalation Channel: ${guardrailResult.escalation_channel}`);
    if (guardrailResult.flagged_phrases) console.log(`   Flagged Phrases: ${guardrailResult.flagged_phrases.join(", ")}`);

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("FULL PIPELINE SUMMARY");
    console.log("=".repeat(80));
    console.log(`Event: ${event.type}`);
    console.log(`Lead: ${lead.contact_name} (${lead.contact_email})`);
    console.log(`AI Decision: ${decision.action_type} (confidence: ${decision.confidence_score})`);
    console.log(`Guardrail Outcome: ${guardrailResult.outcome} — ${guardrailResult.reason}`);
    console.log(`Duration: ${duration}ms`);
    console.log("=".repeat(80));

  } catch (err) {
    console.error("❌ Claude call failed:", err instanceof Error ? err.message : err);
  }
}

main().catch(console.error);

/**
 * Central AI Reasoning Function for Skyler.
 *
 * The brain. Takes any event type, assembles full context, calls Claude Sonnet
 * (via model router) for a structured decision, validates it, and returns it.
 *
 * This function does NOT execute the decision — it only decides.
 * The guardrail engine checks it, then the executor acts on it.
 *
 * Uses the model router for proper tier routing and prompt caching
 * on the static system prompt portion (~90% input token savings).
 */

import { SkylerDecisionSchema, type SkylerDecision } from "./decision-schema";
import {
  assembleReasoningContext,
  formatReasoningPrompt,
  type ReasoningEvent,
} from "./context-assembler";
import {
  routedLLMCall,
  getModelId,
  type TokenUsage,
} from "@/lib/skyler/routing/model-router";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReasoningResult = {
  decision: SkylerDecision;
  /** Whether this was a fallback escalation due to an error */
  is_fallback: boolean;
  /** Model used for the reasoning call */
  model: string;
  /** Time taken for the reasoning call in ms */
  duration_ms: number;
  /** Token usage from the model router */
  token_usage?: TokenUsage;
};

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_TOKENS = 1500;
const RETRY_MAX_TOKENS = 3000;

const REASONING_SYSTEM_PROMPT = `You are Skyler, a Sales AI Employee. You are making a decision about what to do next for a lead in your sales pipeline.

You think like a sales professional. You are strategic, empathetic, and results-driven. You understand that timing, tone, and persistence matter in sales.

RULES:
- Pick ONE action. The best single action right now.
- Be specific in your reasoning — reference the actual context (lead name, what they said, where they are in the pipeline).
- For emails, write the FULL email content ready to send. Match the communication style configured in your settings.
- For follow-ups, choose a delay that makes sense given the context (don't follow up too aggressively or too passively).
- If you're not sure what to do, it's better to escalate than to take a bad action.
- Your confidence_score should reflect how certain you are: 0.9+ = very confident, 0.7-0.9 = confident, 0.5-0.7 = uncertain, <0.5 = you really need a human to look at this.

INFORMATION TIERS — CRITICAL:

REQUIRED (never fabricate — use request_info if missing):
- Financial figures, payment details, bank information, account numbers
- Client-specific data (addresses, contact details not in your context)
- Legal terms, contract specifics, SLAs
- Specific pricing not in the pricing structure from Workflow Settings
- Delivery timelines or commitments not previously agreed
- Technical specifications or integration details

OPTIONAL (include if available, omit gracefully if not — don't ask):
- PO numbers, reference numbers
- Secondary contacts
- Additional context that would improve but isn't critical

GENERATABLE (compose freely):
- Professional greetings and closings
- Email structure and transitions
- Service descriptions based on the company's products/playbook
- Follow-up questions and calls to action
- Professional tone and formatting

When you encounter ANY item from the REQUIRED tier that is NOT in your context, you MUST choose action_type "request_info" instead of drafting with placeholders. It is ALWAYS better to ask than to guess.

Respond with ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

// ── Core reasoning function ──────────────────────────────────────────────────

export async function reasonAboutEvent(
  event: ReasoningEvent,
  workspaceId: string,
  pipelineId: string
): Promise<ReasoningResult> {
  const start = Date.now();
  const model = getModelId("complex");

  // 1. Assemble context
  let ctx;
  try {
    ctx = await assembleReasoningContext(event, workspaceId, pipelineId);
  } catch (err) {
    console.error(
      "[skyler-reasoning] Context assembly failed:",
      err instanceof Error ? err.message : err
    );
    return fallbackEscalation(
      `Context assembly failed: ${err instanceof Error ? err.message : "unknown error"}`,
      Date.now() - start
    );
  }

  // 2. Format the reasoning prompt
  const userPrompt = formatReasoningPrompt(ctx);

  // 3. Call Claude Sonnet via model router (with prompt caching)
  let decision: SkylerDecision | null = null;
  let tokenUsage: TokenUsage | undefined;

  // First attempt
  const result1 = await callReasoning(userPrompt, MAX_TOKENS, 0);
  decision = result1.decision;
  tokenUsage = result1.usage;

  // Retry once with higher max_tokens if first attempt failed
  if (!decision) {
    console.warn(
      "[skyler-reasoning] First attempt failed, retrying with higher max_tokens"
    );
    const result2 = await callReasoning(userPrompt, RETRY_MAX_TOKENS, 1);
    decision = result2.decision;
    tokenUsage = result2.usage;
  }

  if (!decision) {
    console.error(
      "[skyler-reasoning] Both attempts failed, falling back to escalation"
    );
    return fallbackEscalation(
      "Claude failed to return a valid decision after 2 attempts",
      Date.now() - start
    );
  }

  const duration = Date.now() - start;
  console.log(
    `[skyler-reasoning] Decision: ${decision.action_type} (confidence: ${decision.confidence_score}, urgency: ${decision.urgency}) in ${duration}ms`
  );
  console.log(`[skyler-reasoning] Reasoning: ${decision.reasoning}`);

  return {
    decision,
    is_fallback: false,
    model,
    duration_ms: duration,
    token_usage: tokenUsage,
  };
}

// ── Routed call with validation ──────────────────────────────────────────────

async function callReasoning(
  userPrompt: string,
  maxTokens: number,
  attempt: number
): Promise<{ decision: SkylerDecision | null; usage?: TokenUsage }> {
  try {
    const result = await routedLLMCall({
      task: "reason_about_event",
      tier: "complex",
      systemPrompt: REASONING_SYSTEM_PROMPT,
      userContent: userPrompt,
      maxTokens,
      cacheSystemPrompt: true, // Enable prompt caching on system prompt
      attempt,
    });

    // Check stop reason
    if (result.stopReason === "max_tokens") {
      console.warn("[skyler-reasoning] Response truncated (max_tokens)");
      return { decision: null, usage: result.usage };
    }

    if (!result.text) {
      console.warn("[skyler-reasoning] Empty response");
      return { decision: null, usage: result.usage };
    }

    // Parse JSON
    const parsed = parseAIJson<Record<string, unknown>>(result.text);

    // Validate against Zod schema
    const validation = SkylerDecisionSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn(
        "[skyler-reasoning] Schema validation failed:",
        validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      );
      return { decision: null, usage: result.usage };
    }

    return { decision: validation.data, usage: result.usage };
  } catch (err) {
    console.error(
      "[skyler-reasoning] Call failed:",
      err instanceof Error ? err.message : err
    );
    return { decision: null };
  }
}

// ── Fallback escalation ──────────────────────────────────────────────────────

function fallbackEscalation(
  reason: string,
  durationMs: number
): ReasoningResult {
  return {
    decision: {
      action_type: "escalate",
      parameters: {
        escalation_reason: `Skyler's reasoning engine encountered an error and could not make a decision. Reason: ${reason}. A human should review this lead.`,
      },
      reasoning: `Automatic escalation: ${reason}`,
      confidence_score: 0,
      urgency: "immediate",
    },
    is_fallback: true,
    model: getModelId("complex"),
    duration_ms: durationMs,
  };
}

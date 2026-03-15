/**
 * Central AI Reasoning Function for Skyler.
 *
 * The brain. Takes any event type, assembles full context, calls Claude Sonnet
 * for a structured decision, validates it, and returns the decision object.
 *
 * This function does NOT execute the decision — it only decides.
 * The guardrail engine checks it, then the executor acts on it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SkylerDecisionSchema, type SkylerDecision } from "./decision-schema";
import {
  assembleReasoningContext,
  formatReasoningPrompt,
  type ReasoningEvent,
} from "./context-assembler";
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
};

// ── Constants ────────────────────────────────────────────────────────────────

const REASONING_MODEL = "claude-sonnet-4-20250514";
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

Respond with ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

// ── Core reasoning function ──────────────────────────────────────────────────

export async function reasonAboutEvent(
  event: ReasoningEvent,
  workspaceId: string,
  pipelineId: string
): Promise<ReasoningResult> {
  const start = Date.now();

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

  // 3. Call Claude Sonnet
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  let decision: SkylerDecision | null = null;
  let lastError: string | null = null;

  // First attempt
  decision = await callClaude(anthropic, userPrompt, MAX_TOKENS);

  // Retry once with higher max_tokens if first attempt failed
  if (!decision) {
    console.warn(
      "[skyler-reasoning] First attempt failed, retrying with higher max_tokens"
    );
    decision = await callClaude(anthropic, userPrompt, RETRY_MAX_TOKENS);
  }

  if (!decision) {
    console.error(
      "[skyler-reasoning] Both attempts failed, falling back to escalation"
    );
    return fallbackEscalation(
      lastError ?? "Claude failed to return a valid decision after 2 attempts",
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
    model: REASONING_MODEL,
    duration_ms: duration,
  };
}

// ── Claude call with validation ──────────────────────────────────────────────

async function callClaude(
  anthropic: Anthropic,
  userPrompt: string,
  maxTokens: number
): Promise<SkylerDecision | null> {
  try {
    const response = await anthropic.messages.create({
      model: REASONING_MODEL,
      max_tokens: maxTokens,
      system: REASONING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Check stop reason
    if (response.stop_reason !== "end_turn") {
      console.warn(
        `[skyler-reasoning] Unexpected stop_reason: ${response.stop_reason}`
      );
      if (response.stop_reason === "max_tokens") {
        // Token truncation — response may be incomplete JSON
        return null;
      }
    }

    // Extract text
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) {
      console.warn("[skyler-reasoning] Empty response from Claude");
      return null;
    }

    // Parse JSON
    const parsed = parseAIJson<Record<string, unknown>>(text);

    // Validate against Zod schema
    const result = SkylerDecisionSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        "[skyler-reasoning] Schema validation failed:",
        result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
      return null;
    }

    return result.data;
  } catch (err) {
    console.error(
      "[skyler-reasoning] Claude call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
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
    model: REASONING_MODEL,
    duration_ms: durationMs,
  };
}

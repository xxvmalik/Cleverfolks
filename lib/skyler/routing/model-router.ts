/**
 * Two-Tier LLM Router for Skyler.
 *
 * Routes tasks to the right model based on complexity:
 * - fast: GPT-4o-mini (classification, extraction, summarisation, knowledge profiles)
 * - complex: Claude Sonnet 4 (reasoning, email composition, deal analysis)
 *
 * Includes attempt-based fallback: first 2 retries use primary model,
 * subsequent retries fall back to GPT-4o-mini.
 */

import Anthropic from "@anthropic-ai/sdk";
import { classifyWithGPT4oMini } from "@/lib/openai-client";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

// ── Model config ─────────────────────────────────────────────────────────────

export type ModelTier = "fast" | "complex";

const MODEL_IDS: Record<ModelTier, string> = {
  fast: "gpt-4o-mini",
  complex: "claude-sonnet-4-20250514",
};

const FALLBACK_TIER: Record<ModelTier, ModelTier> = {
  complex: "fast",
  fast: "fast",
};

// ── Token usage tracking ─────────────────────────────────────────────────────

export type TokenUsage = {
  tier: ModelTier;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
};

function logTokenUsage(task: string, usage: TokenUsage): void {
  const cacheInfo = usage.cache_read_tokens
    ? ` (cache read: ${usage.cache_read_tokens}, cache create: ${usage.cache_creation_tokens ?? 0})`
    : "";
  console.log(
    `[model-router] ${task} → ${usage.tier}/${usage.model}: ${usage.input_tokens} in + ${usage.output_tokens} out${cacheInfo}`
  );
}

// ── Core routing function ────────────────────────────────────────────────────

export type RoutedCallParams = {
  task: string;
  tier: ModelTier;
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number;
  attempt?: number;
  /** Enable prompt caching on the system prompt (Anthropic only) */
  cacheSystemPrompt?: boolean;
};

export type RoutedCallResult = {
  text: string;
  usage: TokenUsage;
  stopReason: string;
};

/**
 * Route an LLM call to the right model based on tier.
 * Handles attempt-based fallback automatically.
 */
export async function routedLLMCall(
  params: RoutedCallParams
): Promise<RoutedCallResult> {
  const { task, tier, attempt = 0 } = params;

  // Attempt-based fallback: after 2 retries, fall back to cheaper tier
  const effectiveTier = attempt > 2 ? FALLBACK_TIER[tier] : tier;
  const model = MODEL_IDS[effectiveTier];

  if (effectiveTier !== tier) {
    console.log(
      `[model-router] ${task}: falling back from ${tier} to ${effectiveTier} (attempt ${attempt})`
    );
  }

  // Route to appropriate provider
  if (effectiveTier === "fast") {
    return await callOpenAI(params, effectiveTier, model);
  }
  return await callAnthropic(params, effectiveTier, model);
}

// ── OpenAI (GPT-4o-mini) ─────────────────────────────────────────────────────

async function callOpenAI(
  params: RoutedCallParams,
  tier: ModelTier,
  model: string
): Promise<RoutedCallResult> {
  const text = await classifyWithGPT4oMini({
    systemPrompt: params.systemPrompt,
    userContent: params.userContent,
    maxTokens: params.maxTokens ?? 200,
    temperature: params.temperature ?? 0,
  });

  // GPT-4o-mini doesn't return detailed token usage through our wrapper
  const usage: TokenUsage = {
    tier,
    model,
    input_tokens: 0, // Not tracked through wrapper
    output_tokens: 0,
  };
  logTokenUsage(params.task, usage);

  return { text, usage, stopReason: "stop" };
}

// ── Anthropic (Sonnet) ──────────────────────────────────────────────────────

async function callAnthropic(
  params: RoutedCallParams,
  tier: ModelTier,
  model: string
): Promise<RoutedCallResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  // Build system prompt with optional caching
  const systemContent: Anthropic.Messages.TextBlockParam[] = params.cacheSystemPrompt
    ? [
        {
          type: "text" as const,
          text: params.systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ]
    : [{ type: "text" as const, text: params.systemPrompt }];

  const response = await anthropic.messages.create({
    model,
    max_tokens: params.maxTokens ?? 1500,
    system: systemContent,
    messages: [{ role: "user", content: params.userContent }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const usage: TokenUsage = {
    tier,
    model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache_read_tokens: (response.usage as any).cache_read_input_tokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache_creation_tokens: (response.usage as any).cache_creation_input_tokens,
  };
  logTokenUsage(params.task, usage);

  return { text, usage, stopReason: response.stop_reason ?? "unknown" };
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/** Quick classification via fast tier. Returns parsed JSON. */
export async function classifyFast<T = Record<string, unknown>>(
  task: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 200
): Promise<T> {
  const result = await routedLLMCall({
    task,
    tier: "fast",
    systemPrompt,
    userContent,
    maxTokens,
    temperature: 0,
  });
  return parseAIJson<T>(result.text);
}

/** Get model ID for a given tier */
export function getModelId(tier: ModelTier): string {
  return MODEL_IDS[tier];
}

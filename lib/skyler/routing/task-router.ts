/**
 * Task-to-Model Tier Router.
 *
 * Maps task names to model tiers. Used by the reasoning pipeline
 * and any future LLM calls to automatically route to the right model.
 */

import type { ModelTier } from "./model-router";

// ── Task-to-tier mapping ─────────────────────────────────────────────────────

const TASK_TIERS: Record<string, ModelTier> = {
  // GPT-4o-mini — fast, cheap, handles everything that isn't complex reasoning
  classify_intent: "fast",
  detect_referral: "fast",
  extract_entities: "fast",
  classify_sentiment: "fast",
  extract_meeting_actions: "fast",
  summarise_company_research: "fast",
  classify_reply_intent: "fast",
  classify_directive: "fast",
  summarise_thread: "fast",
  generate_knowledge_profile: "fast",
  extract_memories: "fast",
  summarise_meeting: "fast",
  generate_conversation_summary: "fast",

  // Claude Sonnet 4 — complex reasoning, composition, analysis
  reason_about_event: "complex",
  compose_email: "complex",
  analyse_deal: "complex",
  handle_objection: "complex",
  plan_meeting_followup: "complex",
};

/**
 * Get the model tier for a given task.
 * Defaults to "complex" for unknown tasks (safe fallback).
 */
export function getTierForTask(task: string): ModelTier {
  return TASK_TIERS[task] ?? "complex";
}

/** Get all tasks for a given tier */
export function getTasksForTier(tier: ModelTier): string[] {
  return Object.entries(TASK_TIERS)
    .filter(([, t]) => t === tier)
    .map(([task]) => task);
}

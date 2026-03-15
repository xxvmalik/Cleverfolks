/**
 * Task-to-Model Tier Router.
 *
 * Maps task names to model tiers. Used by the reasoning pipeline
 * and any future LLM calls to automatically route to the right model.
 */

import type { ModelTier } from "./model-router";

// ── Task-to-tier mapping ─────────────────────────────────────────────────────

const TASK_TIERS: Record<string, ModelTier> = {
  // Tier 1: GPT-4o-mini (fast, cheap)
  classify_intent: "fast",
  detect_referral: "fast",
  extract_entities: "fast",
  classify_sentiment: "fast",
  extract_meeting_actions: "fast",
  summarise_company_research: "fast",
  classify_reply_intent: "fast",
  classify_directive: "fast",

  // Tier 2: Claude Haiku 4.5 (medium)
  summarise_thread: "medium",
  generate_knowledge_profile: "medium",
  extract_memories: "medium",
  summarise_meeting: "medium",
  generate_conversation_summary: "medium",

  // Tier 3: Claude Sonnet 4 (complex, high quality)
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

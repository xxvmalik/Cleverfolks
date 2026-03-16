/**
 * Fact Extractor — extracts structured key-value facts from user messages.
 *
 * When a user responds to a request_info (e.g., provides payment details),
 * this uses GPT-4o-mini (Tier 1) to extract individual facts that are then
 * stored permanently in agent_memories.
 *
 * Uses the model router for consistent cost tracking.
 */

import {
  routedLLMCall,
} from "@/lib/skyler/routing/model-router";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import type { AgentMemoryCategory } from "./agent-memory-store";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExtractedFact = {
  fact_key: string;
  fact_value: string;
  category: AgentMemoryCategory;
  /** Whether this is a workspace-level fact (true) or lead-specific (false) */
  is_workspace_level: boolean;
};

// ── Extraction ───────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a user's message. The user is providing business information to an AI sales assistant.

Extract each distinct piece of information as a separate fact. Use snake_case keys.

Categories:
- "payment" — bank details, PayPal, payment methods, account numbers, sort codes
- "company" — company name, address, registration info, billing address
- "legal" — legal entity name, governing law, contract terms, SLAs
- "preference" — communication preferences, meeting preferences
- "contact" — phone numbers, secondary contacts, titles
- "product" — service details, deliverables, specifications
- "pricing" — pricing tiers, discounts, special rates
- "technical" — API keys, integration details, technical requirements

For each fact, determine scope:
- is_workspace_level: true if this applies to ALL leads (e.g., company bank details, payment methods)
- is_workspace_level: false if this is specific to one lead/deal (e.g., custom pricing for this client)

Respond with ONLY a JSON array:
[
  { "fact_key": "payment_bank_name", "fact_value": "Barclays", "category": "payment", "is_workspace_level": true },
  { "fact_key": "payment_account_number", "fact_value": "12345678", "category": "payment", "is_workspace_level": true }
]

If the message contains no extractable facts, return an empty array: []`;

/**
 * Extract structured facts from a user's response message.
 * Uses GPT-4o-mini for cost efficiency (~$0.001 per extraction).
 */
export async function extractFacts(
  userMessage: string,
  originalRequest?: string
): Promise<ExtractedFact[]> {
  try {
    const context = originalRequest
      ? `The AI previously asked: "${originalRequest}"\n\nThe user responded:\n"${userMessage}"`
      : `The user said:\n"${userMessage}"`;

    const result = await routedLLMCall({
      task: "extract_facts",
      tier: "fast",
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userContent: context,
      maxTokens: 1000,
    });

    if (!result.text) return [];

    const parsed = parseAIJson<ExtractedFact[]>(result.text);

    if (!Array.isArray(parsed)) return [];

    // Validate each fact
    const validCategories = new Set([
      "payment", "company", "legal", "preference",
      "contact", "product", "pricing", "technical",
    ]);

    return parsed.filter(
      (f) =>
        f.fact_key &&
        f.fact_value &&
        f.category &&
        validCategories.has(f.category) &&
        typeof f.is_workspace_level === "boolean"
    );
  } catch (err) {
    console.error("[fact-extractor] Extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Correction classifier for Skyler's learning system (Stage 11, Part B).
 *
 * Classifies user messages in chat as corrections (fact, lead directive,
 * behaviour, or general message). Uses GPT-4o-mini for fast classification.
 */

import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

export type CorrectionClassification = {
  type: "fact_correction" | "lead_directive" | "behaviour_correction" | "general_message";
  is_vague: boolean;
  correction_text: string;
};

/**
 * Classify a user message to detect corrections.
 * Returns null if classification fails (caller should treat as general_message).
 */
export async function classifyUserMessage(
  userMessage: string,
  recentContext?: string
): Promise<CorrectionClassification | null> {
  try {
    const result = await routedLLMCall({
      task: "classify-user-correction",
      tier: "fast",
      systemPrompt: `You classify user messages sent to an AI sales assistant named Skyler.

Classify the message as ONE of:
- fact_correction: User is correcting a specific fact (wrong email, wrong pricing, updated info). Example: "The price is $3000 not $2000"
- lead_directive: User is giving an instruction about a specific lead. Example: "Don't email this lead until Friday"
- behaviour_correction: User is giving feedback on HOW Skyler operates (tone, timing, approach, style). Example: "That was too aggressive", "Always use bullet points"
- general_message: Normal conversation, not a correction

Also classify: is this correction VAGUE or SPECIFIC?
- Specific: "Never mention competitor X by name" — clear, actionable
- Vague: "That was too aggressive" — needs clarification (which part? this lead or all?)

Return ONLY valid JSON:
{
  "type": "fact_correction" | "lead_directive" | "behaviour_correction" | "general_message",
  "is_vague": boolean,
  "correction_text": "the core correction extracted from the message"
}`,
      userContent: `${recentContext ? `Recent conversation context:\n${recentContext}\n\n` : ""}User message: "${userMessage}"`,
      maxTokens: 200,
    });

    const parsed = parseAIJson(result.text);
    return {
      type: parsed.type ?? "general_message",
      is_vague: parsed.is_vague ?? false,
      correction_text: parsed.correction_text ?? userMessage,
    };
  } catch (err) {
    console.error("[correction-classifier] Classification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Classify a rejection reason into a correction type.
 * Nine correction types used by the processing pipeline.
 */
export type DetailedCorrectionType =
  | "factual"
  | "tone"
  | "style"
  | "timing"
  | "strategy"
  | "omission"
  | "over_action"
  | "priority"
  | "user_takeover";

export type DetailedClassification = {
  correction_type: DetailedCorrectionType;
  scope: "lead_specific" | "segment" | "workspace" | "global";
  derived_rule: string;
  affected_dimensions?: Array<{
    dimension: string;
    direction: number; // -0.1 or +0.1
  }>;
};

/**
 * Full correction classification — used by the Inngest processing pipeline.
 * Takes a correction text + context and produces type, scope, and derived rule.
 */
export async function classifyCorrectionFull(
  correctionText: string,
  originalAction: Record<string, unknown> | null,
  leadContext?: { companyName?: string; industry?: string; dealStage?: string; dealValue?: number }
): Promise<DetailedClassification | null> {
  try {
    const result = await routedLLMCall({
      task: "classify-correction-full",
      tier: "fast",
      systemPrompt: `You analyze corrections given to an AI sales assistant and extract structured learning data.

Given a correction and the context it was given in, classify:

1. correction_type (one of):
   - factual: Wrong data ("the price is $3000 not $2000")
   - tone: Voice/warmth issue ("too pushy", "too formal")
   - style: Format/structure issue ("use bullet points", "keep it shorter")
   - timing: Follow-up timing ("too early", "should have waited")
   - strategy: Approach issue ("wrong angle for this lead type")
   - omission: Missing content ("you forgot to mention the free trial")
   - over_action: Shouldn't have acted ("don't email them yet")
   - priority: Focus issue ("focus on this lead, not that one")
   - user_takeover: User wants to handle it themselves (NOT a quality correction)

2. scope: Who does this apply to?
   - lead_specific: Just this one lead
   - segment: Leads matching certain criteria (enterprise, healthcare, etc.)
   - workspace: All leads for this workspace
   - global: Universal rule
   Default to lead_specific when uncertain.

3. derived_rule: A clear, actionable instruction Skyler should follow in future.
   Example: Correction "that email was too pushy" → Rule "Use softer CTAs. Instead of 'Book a call now', try 'Happy to chat if you're interested'"

4. affected_dimensions (only for tone/style corrections):
   Six dimensions, each -1.0 to +1.0:
   - warmth: cold (-1) ↔ warm (+1)
   - formality: casual (-1) ↔ formal (+1)
   - assertiveness: passive (-1) ↔ aggressive (+1)
   - verbosity: concise (-1) ↔ detailed (+1)
   - urgency: patient (-1) ↔ pushy (+1)
   - personalization: generic (-1) ↔ highly personal (+1)
   Return which dimension(s) are affected and direction (+0.1 or -0.1).

Return ONLY valid JSON:
{
  "correction_type": "...",
  "scope": "...",
  "derived_rule": "...",
  "affected_dimensions": [{ "dimension": "...", "direction": 0.1 }]
}`,
      userContent: `Correction: "${correctionText}"
${originalAction ? `\nOriginal action that was rejected: ${JSON.stringify(originalAction).slice(0, 1000)}` : ""}
${leadContext ? `\nLead context: ${JSON.stringify(leadContext)}` : ""}`,
      maxTokens: 400,
    });

    const parsed = parseAIJson(result.text);
    return {
      correction_type: parsed.correction_type ?? "tone",
      scope: parsed.scope ?? "lead_specific",
      derived_rule: parsed.derived_rule ?? correctionText,
      affected_dimensions: parsed.affected_dimensions,
    };
  } catch (err) {
    console.error("[correction-classifier] Full classification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

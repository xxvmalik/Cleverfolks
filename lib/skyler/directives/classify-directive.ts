/**
 * Directive Classifier for Skyler.
 *
 * Uses GPT-4o-mini to determine if a user message about a specific lead
 * is a directive (instruction) vs a general question.
 *
 * Examples of directives:
 * - "Push for a paid trial with this lead"
 * - "Don't send any more emails until next week"
 * - "Focus on the pricing angle"
 *
 * Examples of NON-directives:
 * - "What's the status of this lead?"
 * - "How many emails have we sent?"
 * - "What did they reply?"
 */

import { classifyFast } from "@/lib/skyler/routing/model-router";

type ClassificationResult = {
  is_directive: boolean;
  directive_text: string | null;
};

const SYSTEM_PROMPT = `You classify whether a user message about a sales lead is a DIRECTIVE (specific instruction about how to handle the lead) or a GENERAL QUESTION.

A DIRECTIVE is an instruction that should persist and influence future AI decisions about this lead. Examples:
- "Push for a paid trial" → directive
- "Don't mention pricing until they bring it up" → directive
- "Follow up more aggressively" → directive
- "Hold off on emails until next week" → directive
- "Focus on the ROI angle" → directive

A GENERAL QUESTION is asking for info, status, or analysis. Examples:
- "What's the status?" → not a directive
- "How many emails have we sent?" → not a directive
- "Draft an email to them" → not a directive (this is a one-time action, not a persistent instruction)
- "What did they say in their last reply?" → not a directive

Respond with JSON: { "is_directive": true/false, "directive_text": "cleaned up directive text or null" }

If it IS a directive, clean up the text to be a clear instruction (remove filler words, make it actionable).`;

export async function classifyDirective(
  userMessage: string
): Promise<ClassificationResult> {
  try {
    return await classifyFast<ClassificationResult>(
      "classify_directive",
      SYSTEM_PROMPT,
      userMessage,
      200
    );
  } catch (err) {
    console.error("[classify-directive] Failed:", err instanceof Error ? err.message : err);
    return { is_directive: false, directive_text: null };
  }
}

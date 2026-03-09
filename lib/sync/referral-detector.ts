/**
 * Sync-time referral detection using Claude Haiku.
 * Analyses email content for referral introduction patterns.
 *
 * This is Layer 3 of the email classification pipeline.
 * Only emails that pass the prefilter AND keyword filter reach this function.
 * Expected: ~10-20% of all emails.
 */

import Anthropic from "@anthropic-ai/sdk";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

export type ReferralResult = {
  is_referral: boolean;
  referrer_name?: string | null;
  referrer_company?: string | null;
};

const REFERRAL_PROMPT = `Classify if this email contains a professional referral — someone recommending or introducing a person/company.

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences:
- Not a referral: {"is_referral": false}
- Referral: {"is_referral": true, "referrer_name": "Full Name", "referrer_company": "Company or null"}

If the referrer's name is unclear, return {"is_referral": false}.`;

/**
 * Truncate email to reduce input tokens.
 * Referral signals are typically in the opening of the email.
 */
function truncateForClassification(text: string, maxChars = 1500): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + "... [truncated]";
}

/**
 * Detect referral signals in email content using Claude Haiku.
 * Returns referral metadata to be stored in document metadata.
 * Never throws — returns { is_referral: false } on any error.
 */
export async function detectReferral(chunkText: string): Promise<ReferralResult> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      system: [
        {
          type: "text",
          text: REFERRAL_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: truncateForClassification(chunkText),
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = parseAIJson<ReferralResult>(text);

    if (parsed.is_referral && parsed.referrer_name) {
      console.log(
        `[referral-detector] Referral detected: ${parsed.referrer_name}${parsed.referrer_company ? ` from ${parsed.referrer_company}` : ""}`
      );
      return parsed;
    }

    return { is_referral: false };
  } catch (err) {
    console.warn(
      "[referral-detector] Failed to detect referral:",
      err instanceof Error ? err.message : String(err)
    );
    return { is_referral: false };
  }
}

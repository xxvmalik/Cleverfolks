/**
 * Sync-time referral detection using Claude Haiku.
 * Analyses email content for referral introduction patterns.
 * Only runs on gmail_message and outlook_email source types.
 */

import Anthropic from "@anthropic-ai/sdk";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

export type ReferralResult = {
  is_referral: boolean;
  referrer_name?: string | null;
  referrer_company?: string | null;
};

const REFERRAL_PROMPT = `You are analysing an email to detect if this is a referral introduction -- meaning someone was referred or recommended by another person.

Look for patterns like:
- "referred by [name]"
- "recommended by [name]"
- "[name] suggested I reach out"
- "[name] from [company] mentioned your name"
- "[name] gave me your details"
- "[name] introduced us"
- "heard about you from [name]"
- "passed your details"
- Any variation indicating one person directed another to make contact

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences. Do NOT include \`\`\`json or \`\`\` markers:
- If NOT a referral: {"is_referral": false}
- If a referral: {"is_referral": true, "referrer_name": "Full Name", "referrer_company": "Company Name"}

If the referrer's company is not mentioned, set referrer_company to null.
If the referrer's name is unclear, set referrer_name to null and is_referral to false.

Email content:
`;

/**
 * Detect referral signals in email content using Claude Haiku.
 * Returns referral metadata to be stored in chunk metadata.
 * Never throws -- returns { is_referral: false } on any error.
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
          content: chunkText.slice(0, 2000), // Cap input to control costs
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

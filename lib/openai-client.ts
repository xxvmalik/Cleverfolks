/**
 * Shared OpenAI client for cost-efficient simple AI tasks.
 * GPT-4o-mini handles classification, extraction, and summarisation
 * at ~13x lower cost than Haiku with equivalent accuracy.
 *
 * Claude Sonnet stays for complex tasks: chat, email drafting, sales playbook.
 */

import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Helper for simple classification/extraction tasks using GPT-4o-mini.
 * Returns the raw text response. Use parseAIJson() to parse JSON responses.
 */
export async function classifyWithGPT4oMini(params: {
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: params.maxTokens ?? 200,
    temperature: params.temperature ?? 0,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

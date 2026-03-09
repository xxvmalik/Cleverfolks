import { classifyWithGPT4oMini } from "@/lib/openai-client";

const SUMMARY_PROMPT = `Summarize the following conversation between a user and CleverBrain (an AI business assistant). Write one focused paragraph for every ~10 messages of conversation. Each paragraph should capture: what was asked, what was answered, specific names/numbers/decisions, and any unresolved questions.

Be specific and factual -- preserve key details like names, amounts, dates, and conclusions. Do NOT generalize or omit important facts. Do NOT include pleasantries or meta-commentary.

Respond with ONLY the summary paragraphs, no preamble.`;

/**
 * Generate a rolling summary of older conversation messages.
 * Uses GPT-4o-mini for cost efficiency.
 */
export async function summarizeConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  if (messages.length === 0) return "";

  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  try {
    const text = await classifyWithGPT4oMini({
      systemPrompt: SUMMARY_PROMPT,
      userContent: `CONVERSATION:\n${conversationText}`,
      maxTokens: 800,
    });

    return text.trim();
  } catch (error) {
    console.error("[conversation-summary] Failed (GPT-4o-mini):", error);
    return "";
  }
}

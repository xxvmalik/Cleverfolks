import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedMemory {
  type: "correction" | "preference" | "terminology" | "pattern" | "learning";
  scope: "workspace" | "user" | "agent";
  content: string;
  confidence: "high" | "medium" | "low";
}

const EXTRACTION_PROMPT = `You are a memory extraction system for an AI business intelligence assistant called CleverBrain. Your job is to analyse a conversation and extract any learnings worth remembering for future conversations.

Extract ONLY genuinely useful information. Most conversations will have 0-3 learnings. Many will have none. Do NOT extract generic observations or restate what the user asked.

Types of things to extract:

1. CORRECTIONS (scope: workspace) — User corrected the AI about a fact
   Examples: "8115 is a service ID not an order ID", "Sarah handles finance not marketing", "Our fiscal year starts in April"

2. PREFERENCES (scope: user) — User expressed how they want responses
   Examples: "Prefers strategic summaries over operational detail", "Wants data in table format", "Prefers concise answers"

3. TERMINOLOGY (scope: workspace) — Business-specific terms the AI didn't know
   Examples: "They call refunds 'reversals'", "'The dashboard' means the Shopify admin panel", "'Pipeline' means deals in negotiation stage"

4. PATTERNS (scope: workspace) — Recurring behaviours or business patterns
   Examples: "CEO asks for competitor analysis before board meetings", "Support queries spike on Mondays"
   Note: patterns usually need multiple conversations to confirm. Only extract if explicitly stated.

5. LEARNINGS (scope: agent) — Things about how the AI should behave better
   Examples: "Competitor queries need specific brand names not categories", "Always check Outlook for calendar events", "This workspace has no Google Calendar"

Rules:
- Return ONLY a JSON array of objects. No markdown, no explanation, no preamble.
- Each object must have: type, scope, content, confidence
- confidence is "high" for explicit corrections/statements, "medium" for inferred preferences, "low" for uncertain patterns
- If nothing worth remembering, return an empty array: []
- content should be a concise, self-contained statement that makes sense without the original conversation
- Do NOT extract: the user's question itself, generic AI knowledge, things already in the business profile, trivial conversational details`;

export async function extractMemories(
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>,
  existingMemories: string[] = []
): Promise<ExtractedMemory[]> {
  if (conversationMessages.length < 2) return [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Format conversation for analysis
  const conversationText = conversationMessages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");

  // Include existing memories so we don't extract duplicates
  const existingContext =
    existingMemories.length > 0
      ? `\n\nEXISTING MEMORIES (do NOT re-extract these):\n${existingMemories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
      : "";

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}${existingContext}\n\nCONVERSATION TO ANALYSE:\n${conversationText}\n\nExtract learnings as a JSON array:`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    console.log(`[memory-extractor] Raw Claude response: ${textBlock?.type === 'text' ? textBlock.text.slice(0, 500) : 'no text block'}`);
    if (!textBlock || textBlock.type !== "text") return [];

    // Parse JSON response, handling potential markdown fences
    let jsonStr = textBlock.text.trim();
    jsonStr = jsonStr
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    // Normalize and validate each memory
    return parsed
      .map((m: Record<string, unknown>) => ({
        ...m,
        type: typeof m.type === "string" ? m.type.toLowerCase() : m.type,
        scope: typeof m.scope === "string" ? m.scope.toLowerCase() : m.scope,
        confidence: typeof m.confidence === "string" ? m.confidence.toLowerCase() : m.confidence,
      }))
      .filter(
        (m: unknown): m is ExtractedMemory =>
          typeof m === "object" &&
          m !== null &&
          "type" in m &&
          "scope" in m &&
          "content" in m &&
          "confidence" in m &&
          ["correction", "preference", "terminology", "pattern", "learning"].includes(
            (m as ExtractedMemory).type
          ) &&
          ["workspace", "user", "agent"].includes(
            (m as ExtractedMemory).scope
          ) &&
          ["high", "medium", "low"].includes(
            (m as ExtractedMemory).confidence
          ) &&
          typeof (m as ExtractedMemory).content === "string" &&
          (m as ExtractedMemory).content.length > 0
      );
  } catch (error) {
    console.error("[memory-extractor] Failed to extract memories:", error);
    return [];
  }
}

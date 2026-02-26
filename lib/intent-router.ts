import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

export type IntentCategory =
  | "conversational"
  | "general_knowledge"
  | "web_search"
  | "internal_data"
  | "hybrid"
  | "creative";

export type IntentRouting = {
  intent: IntentCategory;
  reasoning: string;
  web_query: string | null;
  /** Whether the RAG pipeline (embed + hybrid search) should run. */
  search_needed: boolean;
  /** True when the company knowledge profile alone can answer the question. */
  profile_sufficient: boolean;
};

// ── Safe fallback ─────────────────────────────────────────────────────────────
// Used when the Claude response can't be parsed.
const FALLBACK: IntentRouting = {
  intent: "internal_data",
  reasoning: "Defaulting to internal search (parse failed)",
  web_query: null,
  search_needed: true,
  profile_sufficient: false,
};

// ── JSON extraction (same helper pattern as knowledge-profile builder) ────────
function extractJSON(text: string): IntentRouting | null {
  const clean = text.trim();
  // Direct parse
  try {
    return JSON.parse(clean) as IntentRouting;
  } catch {
    /* fall through */
  }
  // Strip markdown fences
  const fenced = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as IntentRouting;
    } catch {
      /* fall through */
    }
  }
  // First bare { ... } block
  const raw = clean.match(/\{[\s\S]*\}/);
  if (raw) {
    try {
      return JSON.parse(raw[0]) as IntentRouting;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildClassifierPrompt(
  message: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  const recentHistory =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-4) // last 4 turns for brevity
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join("\n")
      : "(no prior conversation)";

  const profileSummary =
    knowledgeProfile && Object.keys(knowledgeProfile).length > 0
      ? `Team members: ${(knowledgeProfile.team_members ?? [])
          .slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((m: any) => m.name)
          .join(", ")}. Channels: ${(knowledgeProfile.channels ?? [])
          .slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => `#${c.name}`)
          .join(", ")}.`
      : "(no profile available)";

  return `You are an intent classifier for a business AI assistant. Classify the user's message and return a routing plan.

RECENT CONVERSATION:
${recentHistory}

COMPANY PROFILE SUMMARY:
${profileSummary}

USER MESSAGE: "${message}"

INTENT CATEGORIES:
- conversational: greetings, thanks, small talk, meta questions about CleverBrain itself. No search needed.
- general_knowledge: definitions, concepts, general how-to advice not specific to this company. Claude can answer from training data.
- web_search: questions requiring current external information — industry trends, competitor info, market data, news, recent events.
- internal_data: questions about the company's own data — what happened in Slack, who said what, team activity, orders, messages. Needs RAG search.
- hybrid: needs BOTH internal company data AND external web/general knowledge. Example: "how does our complaint rate compare to industry average".
- creative: generate content like emails, documents, reports, summaries. May need internal context for personalization.

When generating web_query for web_search or hybrid intents:
- Make the query as specific as possible using context from the RECENT CONVERSATION.
- For follow-up questions, ALWAYS carry the main subject forward. If the user previously asked about "Instagram algorithm" and now asks "was the last update really in 2024?", the web_query MUST be "Instagram algorithm update 2024", not "algorithm update 2024".
- Include the specific product, company, platform, or person being discussed.

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "intent": "one of the 6 categories",
  "reasoning": "one sentence explaining the classification",
  "web_query": "specific Tavily search query if intent is web_search or hybrid, otherwise null",
  "search_needed": true or false (whether internal RAG search is needed),
  "profile_sufficient": true or false (whether the company knowledge profile alone can answer this without full RAG search)
}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function classifyIntent({
  message,
  knowledgeProfile,
  conversationHistory,
}: {
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null;
  conversationHistory: Array<{ role: string; content: string }>;
}): Promise<IntentRouting> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildClassifierPrompt(
      message,
      knowledgeProfile,
      conversationHistory
    );

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = extractJSON(text);

    if (!parsed) {
      console.warn("[intent-router] Failed to parse response:", text.slice(0, 200));
      return FALLBACK;
    }

    // Validate intent category
    const validIntents: IntentCategory[] = [
      "conversational",
      "general_knowledge",
      "web_search",
      "internal_data",
      "hybrid",
      "creative",
    ];
    if (!validIntents.includes(parsed.intent as IntentCategory)) {
      console.warn("[intent-router] Unknown intent:", parsed.intent);
      return FALLBACK;
    }

    console.log(
      `[intent-router] intent=${parsed.intent} profile_sufficient=${parsed.profile_sufficient} search_needed=${parsed.search_needed} — ${parsed.reasoning}`
    );
    return parsed;
  } catch (err) {
    console.error("[intent-router] classifyIntent failed:", err);
    return FALLBACK;
  }
}

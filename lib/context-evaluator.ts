import Anthropic from "@anthropic-ai/sdk";
import type { UnifiedResult } from "./strategy-executor";
import type { SearchStrategy, StrategyType } from "./query-planner";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContextEvaluation = {
  sufficient: boolean;
  /** Follow-up strategies to execute if not sufficient. Empty when sufficient. */
  strategies: SearchStrategy[];
};

// ── Safe fallback ──────────────────────────────────────────────────────────────

const SUFFICIENT: ContextEvaluation = { sufficient: true, strategies: [] };

// ── JSON extraction ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJSON(text: string): Record<string, any> | null {
  const clean = text.trim();
  try {
    return JSON.parse(clean);
  } catch {
    /* fall through */
  }
  const fenced = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const raw = clean.match(/\{[\s\S]*\}/);
  if (raw) {
    try {
      return JSON.parse(raw[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildEvalPrompt(
  message: string,
  chunks: UnifiedResult[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null
): string {
  const count = chunks.length;

  const preview =
    count === 0
      ? "(no chunks retrieved)"
      : chunks
          .slice(0, 3)
          .map((c, i) => {
            const meta = c.metadata ?? {};
            const channel =
              (meta.channel_name as string | undefined) ??
              (meta.channel_id as string | undefined);
            const label = channel
              ? `${c.source_type} #${channel}`
              : c.source_type;
            const text = c.chunk_text
              .slice(0, 200)
              .replace(/\n/g, " ")
              .trim();
            return `[${i + 1}] ${label}: "${text}..."`;
          })
          .join("\n");

  const profileSummary =
    knowledgeProfile && Object.keys(knowledgeProfile).length > 0
      ? `Team: ${(knowledgeProfile.team_members ?? [])
          .slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((m: any) => m.name)
          .join(", ")}.`
      : "(no profile)";

  return `You are evaluating whether the retrieved context is sufficient to answer a user's question well.

User's question: ${message}
Number of chunks retrieved: ${count}
Context preview (first 3 chunks):
${preview}

Company profile: ${profileSummary}

Evaluate:
1. Does the context contain information directly relevant to the question?
2. Is there an obvious gap — like finding a reaction/reply without the original message, or finding a reference to something without the actual details?
3. Would a follow-up search with different terms likely find the missing information?

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "sufficient": true or false,
  "confidence": 0.0-1.0,
  "gap": "one sentence describing what's missing, or null if sufficient",
  "follow_up_strategies": [
    {
      "type": "semantic | person_search | channel_search | surrounding_context | broad_fetch",
      "params": {
        "query": "search query if semantic",
        "person_name": "name if person_search",
        "channel_name": "name if channel_search",
        "after": "ISO date if time-filtered",
        "before": "ISO date if time-filtered"
      },
      "reason": "why this search would fill the gap"
    }
  ]
}

If sufficient is true, follow_up_strategies should be an empty array.
If the context is empty (0 chunks), mark sufficient as false with gap explaining no results were found.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

const EVAL_TIMEOUT_MS = 3000;

const VALID_FOLLOW_UP_TYPES: StrategyType[] = [
  "semantic",
  "person_search",
  "channel_search",
  "surrounding_context",
  "broad_fetch",
];

export async function evaluateContext({
  message,
  chunks,
  knowledgeProfile,
}: {
  message: string;
  chunks: UnifiedResult[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null;
  conversationHistory: Array<{ role: string; content: string }>;
}): Promise<ContextEvaluation> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildEvalPrompt(message, chunks, knowledgeProfile);

    // Race the API call against a hard timeout
    const result = await Promise.race<Anthropic.Message | null>([
      anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), EVAL_TIMEOUT_MS)
      ),
    ]);

    if (!result) {
      console.warn("[context-evaluator] Timeout — treating as sufficient");
      return SUFFICIENT;
    }

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const parsed = extractJSON(text);

    if (!parsed) {
      console.warn(
        "[context-evaluator] Failed to parse response:",
        text.slice(0, 200)
      );
      return SUFFICIENT;
    }

    const sufficient = Boolean(parsed.sufficient);

    if (sufficient) {
      console.log(
        `[context-evaluator] sufficient (confidence=${parsed.confidence ?? "?"}) for ${chunks.length} chunks`
      );
      return SUFFICIENT;
    }

    const rawStrategies = Array.isArray(parsed.follow_up_strategies)
      ? parsed.follow_up_strategies
      : [];

    const strategies: SearchStrategy[] = rawStrategies
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) =>
          s &&
          typeof s.type === "string" &&
          VALID_FOLLOW_UP_TYPES.includes(s.type as StrategyType)
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any) => ({
        type: s.type as StrategyType,
        params: s.params ?? {},
      }));

    console.log(
      `[context-evaluator] not sufficient — gap: "${parsed.gap ?? "?"}" — follow-ups: ${strategies.map((s) => s.type).join(", ") || "none"}`
    );

    return { sufficient: false, strategies };
  } catch (err) {
    console.error("[context-evaluator] evaluateContext failed:", err);
    return SUFFICIENT;
  }
}

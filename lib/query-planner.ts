import Anthropic from "@anthropic-ai/sdk";
import type { QueryAnalysis } from "./query-analyzer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrategyType =
  | "semantic"
  | "broad_fetch"
  | "person_search"
  | "channel_search"
  | "surrounding_context"
  | "profile_only";

export type SearchStrategy = {
  type: StrategyType;
  params: {
    query?: string;
    person_name?: string;
    channel_name?: string;
    /** ISO date string */
    after?: string;
    /** ISO date string */
    before?: string;
    /** Which prior strategy's results to enrich with surrounding context.
     *  "all" = every strategy's results; number = zero-based strategy index. */
    apply_to?: "all" | number | string;
  };
};

export type QueryPlan = {
  strategies: SearchStrategy[];
  reasoning: string;
  /** True when the plan is the hard-coded fallback (parse failed). */
  isFallback?: boolean;
};

// ── Fallback ──────────────────────────────────────────────────────────────────

const FALLBACK_PLAN: QueryPlan = {
  strategies: [{ type: "semantic", params: {} }],
  reasoning: "Defaulting to semantic search (parse failed)",
  isFallback: true,
};

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJSON(text: string): QueryPlan | null {
  const clean = text.trim();
  try {
    return JSON.parse(clean) as QueryPlan;
  } catch {
    /* fall through */
  }
  const fenced = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as QueryPlan;
    } catch {
      /* fall through */
    }
  }
  const raw = clean.match(/\{[\s\S]*\}/);
  if (raw) {
    try {
      return JSON.parse(raw[0]) as QueryPlan;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPlannerPrompt(
  message: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null,
  conversationHistory: Array<{ role: string; content: string }>,
  queryAnalysis: QueryAnalysis
): string {
  const recentHistory =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-4)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join("\n")
      : "(no prior conversation)";

  const profileSummary =
    knowledgeProfile && Object.keys(knowledgeProfile).length > 0
      ? `Team: ${(knowledgeProfile.team_members ?? [])
          .slice(0, 8)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((m: any) => m.name)
          .join(", ")}. Channels: ${(knowledgeProfile.channels ?? [])
          .slice(0, 8)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => `#${c.name}`)
          .join(", ")}.`
      : "(no profile available)";

  const timeRangeInfo = queryAnalysis.timeRange
    ? `after=${queryAnalysis.timeRange.after?.toISOString() ?? "none"}, before=${queryAnalysis.timeRange.before?.toISOString() ?? "none"}`
    : "none detected";

  return `You are a search strategist for a business AI assistant. Given the user's question, company profile, conversation history, and extracted time range, decide the optimal search strategy.

Available strategies:
- semantic: Standard hybrid search (vector + keyword). Best for specific topic questions.
- broad_fetch: Fetch all messages from a time period. Best for summary/overview questions. Requires a time range.
- person_search: Search by person name. Best when asking about a specific person's activity. Requires person_name.
- channel_search: Search by channel. Best when asking about a specific channel. Requires channel_name.
- surrounding_context: After finding results, fetch surrounding messages for context. Use when the question asks about reasons, context, or 'why' something happened.
- profile_only: The knowledge profile alone can answer this. No search needed.

You can combine multiple strategies. For example:
- 'Why are we celebrating Hassan?' → semantic search for 'celebrating Hassan' + surrounding_context on results
- 'What has Peters been working on this week?' → person_search for 'Peters' with time range
- 'What's happening in #operations?' → channel_search for 'operations'
- 'Who is on the team?' → profile_only
- 'Compare complaints this week vs last week' → broad_fetch for this week + broad_fetch for last week

RECENT CONVERSATION:
${recentHistory}

COMPANY PROFILE:
${profileSummary}

USER MESSAGE: "${message}"

EXTRACTED TIME RANGE: ${timeRangeInfo}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "strategies": [
    {
      "type": "semantic | broad_fetch | person_search | channel_search | surrounding_context | profile_only",
      "params": {
        "query": "search query if semantic",
        "person_name": "name if person_search",
        "channel_name": "name if channel_search",
        "after": "ISO date string if time-filtered",
        "before": "ISO date string if time-filtered",
        "apply_to": "all or strategy index number for surrounding_context"
      }
    }
  ],
  "reasoning": "one sentence explaining the plan"
}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function planQuery({
  message,
  knowledgeProfile,
  conversationHistory,
  queryAnalysis,
}: {
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null;
  conversationHistory: Array<{ role: string; content: string }>;
  queryAnalysis: QueryAnalysis;
}): Promise<QueryPlan> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPlannerPrompt(
      message,
      knowledgeProfile,
      conversationHistory,
      queryAnalysis
    );

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = extractJSON(text);

    if (!parsed || !Array.isArray(parsed.strategies)) {
      console.warn(
        "[query-planner] Failed to parse response:",
        text.slice(0, 200)
      );
      return FALLBACK_PLAN;
    }

    // Validate each strategy type
    const validTypes: StrategyType[] = [
      "semantic",
      "broad_fetch",
      "person_search",
      "channel_search",
      "surrounding_context",
      "profile_only",
    ];
    for (const s of parsed.strategies) {
      if (!validTypes.includes(s.type as StrategyType)) {
        console.warn("[query-planner] Unknown strategy type:", s.type);
        return FALLBACK_PLAN;
      }
    }

    console.log(
      `[query-planner] plan: ${parsed.strategies.map((s) => s.type).join(" + ")} — ${parsed.reasoning}`
    );
    return parsed;
  } catch (err) {
    console.error("[query-planner] planQuery failed:", err);
    return FALLBACK_PLAN;
  }
}

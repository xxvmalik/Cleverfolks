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

// ── Profile summary helper ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProfileSummary(profile: Record<string, any>): string {
  const members: Array<{
    name?: string;
    detected_role?: string;
    likely_role?: string;
  }> = profile.team_members ?? [];

  const channels: Array<{
    name?: string;
    purpose?: string;
  }> = profile.channels ?? [];

  const parts: string[] = [];

  if (members.length > 0) {
    const memberLines = members
      .filter((m) => m.name)
      .slice(0, 12)
      .map((m) => {
        const role = m.detected_role ?? m.likely_role ?? "unknown role";
        return `  - ${m.name} (${role})`;
      })
      .join("\n");
    parts.push(`Team members and roles:\n${memberLines}`);
  }

  if (channels.length > 0) {
    const channelLines = channels
      .filter((c) => c.name)
      .slice(0, 10)
      .map((c) => `  - #${c.name}${c.purpose ? `: ${c.purpose}` : ""}`)
      .join("\n");
    parts.push(`Channels:\n${channelLines}`);
  }

  return parts.join("\n\n") || "(no profile data)";
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
      ? buildProfileSummary(knowledgeProfile)
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

When the user asks about a team member by name or role, use person_search with their exact name from the profile.
When the user asks about a channel by name or purpose, use channel_search with the channel name.
When the user asks about a role (e.g. "what is the engineering lead working on?"), resolve the role to a name using the profile, then use person_search.

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

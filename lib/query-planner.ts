import Anthropic from "@anthropic-ai/sdk";
import type { QueryAnalysis } from "./query-analyzer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrategyType =
  | "semantic"
  | "broad_fetch"
  | "person_search"
  | "channel_search"
  | "surrounding_context"
  | "profile_only"
  | "hybrid_aggregation";

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
    /** hybrid_aggregation: channels whose entire purpose matches the query topic —
     *  ALL messages in these channels are counted (no keyword filter). */
    dedicated_channels?: string[];
    /** hybrid_aggregation: keywords for counting topic mentions in non-dedicated channels. */
    keywords?: string[];
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

// ── Profile section builders ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildKnownTeamSection(profile: Record<string, any>): string {
  const members: Array<{
    name?: string;
    detected_role?: string;
    likely_role?: string;
    active_channels?: string[];
  }> = profile.team_members ?? [];

  if (!members.length) return "";

  const lines = members
    .filter((m) => m.name)
    .slice(0, 15)
    .map((m) => {
      const role = m.detected_role ?? m.likely_role ?? "unknown role";
      const channels = (m.active_channels ?? []).filter(Boolean);
      const channelStr =
        channels.length > 0 ? ` — active in ${channels.map((c) => `#${c}`).join(", ")}` : "";
      return `- ${m.name}: ${role}${channelStr}`;
    });

  return `KNOWN TEAM MEMBERS:\n${lines.join("\n")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildKnownChannelsSection(profile: Record<string, any>): string {
  const channels: Array<{
    name?: string;
    purpose?: string;
  }> = profile.channels ?? [];

  if (!channels.length) return "";

  const lines = channels
    .filter((c) => c.name)
    .slice(0, 12)
    .map((c) => `- #${c.name}${c.purpose ? `: ${c.purpose}` : ""}`);

  return `KNOWN CHANNELS:\n${lines.join("\n")}`;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPlannerPrompt(
  message: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null,
  conversationHistory: Array<{ role: string; content: string }>,
  queryAnalysis: QueryAnalysis,
  businessContext?: string
): string {
  const recentHistory =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-4)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join("\n")
      : "(no prior conversation)";

  const teamSection =
    knowledgeProfile && Object.keys(knowledgeProfile).length > 0
      ? buildKnownTeamSection(knowledgeProfile)
      : "";
  const channelSection =
    knowledgeProfile && Object.keys(knowledgeProfile).length > 0
      ? buildKnownChannelsSection(knowledgeProfile)
      : "";

  const profileBlock =
    teamSection || channelSection
      ? [teamSection, channelSection].filter(Boolean).join("\n\n")
      : "(no profile available)";

  const businessContextBlock = businessContext
    ? `BUSINESS CONTEXT:\n${businessContext}`
    : "";

  const timeRangeInfo = queryAnalysis.timeRange
    ? `after=${queryAnalysis.timeRange.after?.toISOString() ?? "none"}, before=${queryAnalysis.timeRange.before?.toISOString() ?? "none"}`
    : "none detected";

  const aggregationFlag = queryAnalysis.isAggregation
    ? `\n⚠️  AGGREGATION DETECTED: This query requires counting or ranking people/channels. You MUST use hybrid_aggregation — do NOT use channel_search, broad_fetch, or semantic for this query.\n`
    : "";

  return `You are a search strategist for a business AI assistant. Your job is to decide the best search strategy for the user's question.

${profileBlock}
${businessContextBlock ? `\n${businessContextBlock}\n` : ""}
CRITICAL INSTRUCTIONS:
1. When the user mentions a ROLE (designer, manager, support lead, etc.), first check if any team member above has that role. If yes, use person_search with their exact name.
2. If NO team member matches the role, think about which CHANNEL relates to that role and use channel_search. Examples: 'designer' → #graphics-contents, 'support' → #order-complaints, 'payments' → #payment-complaints.
3. When the user mentions a CHANNEL by name or topic that maps to a known channel, use channel_search with that channel name.
4. When the user mentions a PERSON by name, use person_search.
5. ONLY use generic semantic search when you cannot map the question to a specific person or channel from the profile above.
6. You can and should combine strategies when helpful (e.g., channel_search + person_search).
7. For questions about what someone has been doing "this week" or "recently", include the time range in the strategy params.
8. For COUNTING or RANKING questions ("who sent the most", "top N people", "how many", "most active", "rank everyone"), ALWAYS use hybrid_aggregation. Identify DEDICATED channels (channels whose entire purpose is about the query topic — count ALL their messages), plus extract 6-10 keywords for catching topic mentions in other channels.

HYBRID_AGGREGATION GUIDE:
- dedicated_channels: list channel names (without #) that are entirely about the query topic
  - For "complaints": ["order-complaints", "payment-complaints"]
  - For "sales": ["sales", "deals", "revenue"]
  - If no channel is dedicated to the topic, use []
- keywords: 6-10 terms that would appear in relevant messages in non-dedicated channels
  - For "complaints": ["complaint", "issue", "problem", "failed", "error", "refund", "broken", "wrong"]
  - For "sales": ["sale", "deal", "closed", "won", "revenue", "customer", "contract"]
  - Extract from business context and query intent; be inclusive, not restrictive

EXAMPLES:
- "When did our designer post designs?" → no designer in profile → channel_search on #graphics-contents
- "What has the Operations Manager been doing?" → Operation Manager is in profile → person_search for "Operation Manager"
- "Any complaints this week?" → channel_search on #order-complaints with time range
- "What did toyin announce?" → person_search for "toyin"
- "Who is on the team?" → profile_only
- "What's happening in #operations?" → channel_search for "operations"
- "Compare complaints this week vs last week" → channel_search #order-complaints with this week's range + channel_search with last week's range
- "Why is ALLI frustrated?" → person_search for "ALLI" + surrounding_context
- "Who reported the most complaints this month?" → hybrid_aggregation with dedicated_channels=["order-complaints","payment-complaints"], keywords=["complaint","issue","problem","failed","refund","wrong","error"], time range
- "Which channel has the most failed orders?" → broad_fetch with time range (channel-level breakdown, not person-level)
- "How many messages did each person send last week?" → hybrid_aggregation with dedicated_channels=[], keywords=[], time range (counts everything)
- "Top 5 most active people this month?" → hybrid_aggregation with dedicated_channels=[], keywords=[], time range
- "Rank everyone by complaints reported" → hybrid_aggregation with dedicated_channels=["order-complaints","payment-complaints"], keywords=["complaint","issue","problem","failed","refund"]

Available strategies:
- semantic: Vector + keyword hybrid search. Use as a fallback when no person/channel match. Do NOT use for counting/ranking questions.
- broad_fetch: Fetch messages from a time period. Use for SUMMARY questions and CHANNEL-level breakdowns. Do NOT use for person-level counting (use hybrid_aggregation instead).
- person_search: Search by person name. Requires person_name param.
- channel_search: Search by channel name. Requires channel_name param.
- surrounding_context: Fetch surrounding messages for context around found results.
- profile_only: Answer from profile alone — no search needed.
- hybrid_aggregation: SQL counts per person (dedicated channels: all messages; other channels: keyword-matched) + 300-message sample. Use for ALL person-level counting and ranking questions.

RECENT CONVERSATION:
${recentHistory}
${aggregationFlag}
USER MESSAGE: "${message}"
EXTRACTED TIME RANGE: ${timeRangeInfo}
IS AGGREGATION QUERY: ${queryAnalysis.isAggregation ? "YES — must use hybrid_aggregation" : "no"}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "strategies": [
    {
      "type": "semantic | broad_fetch | person_search | channel_search | surrounding_context | profile_only | hybrid_aggregation",
      "params": {
        "query": "search query if semantic",
        "person_name": "exact name from profile if person_search",
        "channel_name": "channel name without # if channel_search",
        "after": "ISO date string if time-filtered",
        "before": "ISO date string if time-filtered",
        "apply_to": "all or strategy index number for surrounding_context",
        "dedicated_channels": ["channel-name-1", "channel-name-2"],
        "keywords": ["keyword1", "keyword2", "keyword3"]
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
  businessContext,
}: {
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null;
  conversationHistory: Array<{ role: string; content: string }>;
  queryAnalysis: QueryAnalysis;
  businessContext?: string;
}): Promise<QueryPlan> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPlannerPrompt(
      message,
      knowledgeProfile,
      conversationHistory,
      queryAnalysis,
      businessContext
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
      "hybrid_aggregation",
    ];
    for (const s of parsed.strategies) {
      if (!validTypes.includes(s.type as StrategyType)) {
        console.warn("[query-planner] Unknown strategy type:", s.type);
        return FALLBACK_PLAN;
      }
    }

    // Full plan debug log
    const strategyDetails = parsed.strategies.map((s) => {
      const params = Object.entries(s.params ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ");
      return params ? `${s.type}(${params})` : s.type;
    });
    console.log(
      `[query-planner] plan: [${strategyDetails.join(" + ")}] — ${parsed.reasoning}`
    );

    return parsed;
  } catch (err) {
    console.error("[query-planner] planQuery failed:", err);
    return FALLBACK_PLAN;
  }
}

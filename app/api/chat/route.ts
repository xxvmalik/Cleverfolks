import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { analyzeQuery, type TimeRange, type ComparisonPeriod } from "@/lib/query-analyzer";
import { createEmbedding } from "@/lib/embeddings";
import { classifyIntent } from "@/lib/intent-router";
import { planQuery } from "@/lib/query-planner";
import { executeStrategies, type UnifiedResult } from "@/lib/strategy-executor";
import {
  buildIntegrationManifest,
  detectAmbiguousQuery,
  type IntegrationInfo,
} from "@/lib/integrations-manifest";
import { evaluateContext } from "@/lib/context-evaluator";
import { searchWeb, type WebResult } from "@/lib/web-search";

// ── Types ─────────────────────────────────────────────────────────────────────

type KnowledgeProfileRow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: Record<string, any> | null;
  status: string | null;
};

type SourceInfo = {
  source_type: string;
  title: string;
  channel?: string;
  user_name?: string;
  timestamp?: string;
  similarity?: number;
};

type HistoryMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

// ── Knowledge profile formatter ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatKnowledgeProfile(profile: Record<string, any>): string {
  const sections: string[] = [];

  const members: Array<{
    name?: string;
    detected_role?: string;
    likely_role?: string;
    confidence?: string;
    active_channels?: string[];
    typical_activities?: string;
    notes?: string;
  }> = profile.team_members ?? [];
  if (members.length > 0) {
    const lines = members
      .filter((m) => m.name)
      .map((m) => {
        const role = m.detected_role ?? m.likely_role ?? "unknown role";
        const confidence = m.confidence;
        const confidenceNote =
          confidence === "low" || confidence === "medium"
            ? " [role inferred — may not be exact]"
            : "";
        const channels = (m.active_channels ?? []).join(", ");
        const extra = m.notes ? ` (${m.notes})` : "";
        return `- ${m.name} — ${role}${confidenceNote}. Active in ${channels || "unknown channels"}. ${m.typical_activities ?? ""}${extra}`;
      });
    if (lines.length > 0) sections.push(`Team Members:\n${lines.join("\n")}`);
  }

  const channels: Array<{
    name?: string;
    purpose?: string;
    key_people?: string[];
  }> = profile.channels ?? [];
  if (channels.length > 0) {
    const lines = channels
      .filter((c) => c.name)
      .map((c) => {
        const people =
          (c.key_people ?? []).length > 0
            ? ` Key people: ${c.key_people!.join(", ")}.`
            : "";
        return `- #${c.name} — ${c.purpose ?? ""}${people}`;
      });
    if (lines.length > 0) sections.push(`Channels:\n${lines.join("\n")}`);
  }

  const patterns: string[] = profile.business_patterns ?? [];
  if (patterns.length > 0) {
    sections.push(
      `Business Patterns:\n${patterns.map((p) => `- ${p}`).join("\n")}`
    );
  }

  const terminology: Record<string, string> = profile.terminology ?? {};
  const termEntries = Object.entries(terminology);
  if (termEntries.length > 0) {
    sections.push(
      `Terminology:\n${termEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    );
  }

  const topics: string[] = profile.key_topics ?? [];
  if (topics.length > 0) {
    sections.push(`Key Topics:\n${topics.map((t) => `- ${t}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

// ── System prompt builder ─────────────────────────────────────────────────────

type WorkspaceRow = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: Record<string, any> | null;
};

type IntegrationRow = {
  provider: string;
};

type OnboardingRow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org_data: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skyler_data: Record<string, any> | null;
};

function buildSystemPrompt(
  workspace: WorkspaceRow | null,
  onboarding: OnboardingRow | null,
  knowledgeProfile: KnowledgeProfileRow | null
): string {
  const settings = workspace?.settings ?? {};
  const orgData = onboarding?.org_data ?? {};
  const skylerData = onboarding?.skyler_data ?? {};

  const companyName =
    (settings.company_name as string | undefined)?.trim() ||
    (orgData.step1?.companyName as string | undefined)?.trim() ||
    workspace?.name?.trim() ||
    "your company";

  const lines: string[] = [];

  const description =
    (settings.description as string | undefined)?.trim() ||
    (skylerData.step8?.companyOverview as string | undefined)?.trim();
  if (description) lines.push(`Description: ${description}`);

  const industry =
    (settings.industry as string | undefined)?.trim() ||
    (orgData.step1?.industry as string | undefined)?.trim();
  if (industry && industry !== "Other") lines.push(`Industry: ${industry}`);

  const rawProducts = (orgData.step4?.products ?? []) as Array<{
    name?: string;
    description?: string;
  }>;
  const productLines = rawProducts
    .filter((p) => p.name)
    .map((p) =>
      p.description?.trim() ? `${p.name}: ${p.description.trim()}` : p.name!
    );
  if (productLines.length > 0)
    lines.push(`Products/services: ${productLines.join(", ")}`);

  const teamRoles = (settings.team_roles as string | undefined)?.trim();
  if (teamRoles) lines.push(`Team structure: ${teamRoles}`);

  const targetAudience =
    (orgData.step2?.targetAudience as string | undefined)?.trim() ||
    (skylerData.step8?.idealCustomerProfile as string | undefined)?.trim();
  if (targetAudience) lines.push(`Target customers: ${targetAudience}`);

  const positioning =
    (orgData.step2?.positioning as string | undefined)?.trim() ||
    (skylerData.step8?.uniqueValueProp as string | undefined)?.trim();
  if (positioning) lines.push(`Positioning: ${positioning}`);

  const companySection =
    lines.length > 0 ? `\nCOMPANY CONTEXT:\n${lines.join("\n")}\n` : "";

  // ── Business language context (set by team admin) ───────────────────────
  const businessContext = (settings.business_context as string | undefined)?.trim();
  const businessContextSection = businessContext
    ? `\nBUSINESS LANGUAGE & TERMINOLOGY:\n${businessContext}\n`
    : "";

  // ── Knowledge profile intelligence section ──────────────────────────────
  let intelligenceSection = "";
  if (
    (knowledgeProfile?.status === "ready" ||
      knowledgeProfile?.status === "pending_review") &&
    knowledgeProfile.profile &&
    Object.keys(knowledgeProfile.profile).length > 0
  ) {
    const formatted = formatKnowledgeProfile(knowledgeProfile.profile);
    if (formatted) {
      intelligenceSection = `\nCOMPANY INTELLIGENCE (auto-generated from your connected data):\n${formatted}\n`;
    }
  }

  return `You are CleverBrain, the AI knowledge assistant for ${companyName}. You help team members find information and insights from their connected business data.
${businessContextSection}${intelligenceSection}${companySection}
RULES:
- Answer based on the provided context from connected integrations (Slack messages, emails, documents, etc.)
- If context contains relevant information, give a clear, helpful answer
- If the user's question is vague or unclear, ask a brief clarifying question before searching
- If context doesn't have enough information, say so briefly — one sentence is enough
- When you don't find something, say "I couldn't find that in the available data" and move on
- Reference sources naturally: 'In #channel-name, [person] mentioned...' or 'Based on a message from Feb 20...'
- Keep responses concise and actionable — no unnecessary filler
- Use markdown formatting for readability when helpful
- When synthesizing across multiple messages, organize the information clearly
- If the user asks a follow-up, use conversation history to understand context
- Never be overly apologetic. If you made a mistake, briefly correct yourself and move on.
- When using web search results, cite sources naturally: 'According to [publication]...' to distinguish external information from the company's own data.
- When a team member's role is listed as "[role inferred — may not be exact]", treat it as a reasonable guess and caveat your answer lightly if role attribution matters.
- If asked who handles a specific function and the profile lists a relevant role, name that person from the profile.

DATA INTERPRETATION — CRITICAL:
- When a user says something "isn't an X" or corrects a label (e.g., "8115 isn't an order ID, it's a service ID"), they are correcting the CATEGORY or TERMINOLOGY — not saying the data point doesn't exist. Do NOT abandon the original data point. Stay on it and re-answer using the correct label.
- When a user asks a follow-up about a specific ID or data point (e.g., "what about 8115?"), stay locked on that exact ID. Never silently switch to a different one.
- If the user says "I need names not IDs" or "who is that?", resolve the identifiers to human names using available context. This is a formatting correction — it does not mean the original data was wrong.
- Only abandon a data point if the user explicitly says "that's wrong", "that doesn't exist", or "ignore that" about the data itself — not about how you labelled or described it.

ROLE DISCOVERY:
- Never suggest bot accounts or integration accounts as team members. Accounts with "bot", "integration", "nango", "developer", "cleverfolks_ai", or similar patterns in the name are automated systems, not people.
- When a user asks about a role (e.g., "our designer", "the accountant", "whoever handles refunds") and NO ONE in the Company Intelligence section has that role:
  - Search the retrieved data to identify who is most active in the relevant area
  - Answer the user's question with what you found from the data AND ask for confirmation at the end: "Based on their activity in #[channel], [name] appears to handle [function] — they last posted [brief detail]. Is [name] your [role]?"
  - Do NOT refuse to answer just because you are unsure who the person is. Give your best answer from the data and ask for confirmation.
- When a user CONFIRMS a role (e.g., "yes", "that's right", "correct", "yep"):
  - Acknowledge naturally in 1 sentence
  - Append this exact tag at the very end of your response (after everything else): [ROLE_UPDATE: name=<person name>, role=<role title>]
  - This tag is invisible to the user and is used to update the company profile automatically.
- When a user CORRECTS a role with a different name (e.g., "no, it's actually Hassan"):
  - Acknowledge the correction naturally
  - Append: [ROLE_UPDATE: name=<correct person name>, role=<role title>]`;
}

// ── Vague time reference detection ────────────────────────────────────────────

const VAGUE_TIME_RE =
  /\b(those dates?|that period|that same period|same (time|period|dates?|week|month)|that timeframe?|that week|that month|that day|within that (time|period|week)|during that (time|period|week)|between those (dates?|times?)|those times?|in those days|over that period|around that time|in that time|at that time|back then|the same (week|month|period|dates?|time))\b/i;

// ── Context helpers ───────────────────────────────────────────────────────────

function getChannelName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (
    sourceType === "slack_message" ||
    sourceType === "slack_reply" ||
    sourceType === "slack_reaction"
  ) {
    const name =
      (meta.channel_name as string | undefined) ??
      (meta.channel_id as string | undefined) ??
      "";
    return name ? `#${name}` : "";
  }
  if (sourceType === "gmail_message") {
    const subject = (meta.subject as string | undefined) ?? "";
    return subject ? `📧 ${subject.slice(0, 60)}` : "📧 Gmail";
  }
  return "";
}

function getUserName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply") {
    return (
      (meta.user_name as string | undefined) ??
      (meta.user as string | undefined) ??
      ""
    );
  }
  if (sourceType === "gmail_message") {
    return (
      (meta.user_name as string | undefined) ??
      (meta.sender_name as string | undefined) ??
      (meta.from as string | undefined) ??
      ""
    );
  }
  if (sourceType === "email") {
    return (meta.from as string | undefined) ?? "";
  }
  return "";
}

function formatSourceDate(meta: Record<string, unknown>): string {
  const raw =
    (meta.date as string | undefined) ??
    (meta.ts as string | undefined) ??
    (meta.start as string | undefined) ??
    (meta.modified_time as string | undefined) ??
    (meta.close_date as string | undefined);
  if (!raw) return "";
  try {
    const asFloat = parseFloat(raw);
    const d =
      !isNaN(asFloat) && asFloat > 1_000_000_000
        ? new Date(asFloat * 1000)
        : new Date(raw);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function deduplicateSources(results: UnifiedResult[]): SourceInfo[] {
  const seen = new Map<string, SourceInfo>();
  for (const r of results) {
    if (seen.has(r.document_id)) continue;
    const meta = r.metadata ?? {};
    seen.set(r.document_id, {
      source_type: r.source_type,
      title: r.title,
      channel: getChannelName(r.source_type, meta) || undefined,
      user_name: getUserName(r.source_type, meta) || undefined,
      timestamp: formatSourceDate(meta) || undefined,
      similarity: Math.round(r.similarity * 100) / 100,
    });
  }
  return [...seen.values()];
}

function formatTimeRangeLabel(timeRange: {
  after?: Date;
  before?: Date;
}): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (timeRange.after && timeRange.before) {
    const a = timeRange.after.toLocaleDateString("en-US", opts);
    const b = timeRange.before.toLocaleDateString("en-US", opts);
    return `${a} – ${b}`;
  }
  if (timeRange.after)
    return `since ${timeRange.after.toLocaleDateString("en-US", opts)}`;
  if (timeRange.before)
    return `before ${timeRange.before.toLocaleDateString("en-US", opts)}`;
  return "the selected period";
}

// ── Activity labels from query plan ──────────────────────────────────────────

import type { SearchStrategy } from "@/lib/query-planner";

function getStrategyActivityLabels(
  strategies: SearchStrategy[],
  inheritedTimeRange: TimeRange | null
): string[] {
  const labels: string[] = [];

  for (const strategy of strategies) {
    if (strategy.type === "surrounding_context" || strategy.type === "profile_only") {
      continue; // handled separately below
    }
    if (strategy.type === "person_search" && strategy.params.person_name) {
      labels.push(`Searching ${strategy.params.person_name}'s activity...`);
    } else if (strategy.type === "channel_search" && strategy.params.channel_name) {
      labels.push(`Searching #${strategy.params.channel_name}...`);
    } else if (strategy.type === "broad_fetch") {
      const sts = strategy.params.source_types ?? [];
      const noun =
        sts.length === 1 && sts[0] === "gmail_message" ? "emails"
        : sts.some((s) => s.startsWith("slack_")) && !sts.includes("gmail_message") ? "Slack messages"
        : "messages";
      if (strategy.params.label) {
        labels.push(`Fetching ${strategy.params.label} ${noun}...`);
      } else {
        const after = strategy.params.after
          ? new Date(strategy.params.after)
          : inheritedTimeRange?.after;
        const before = strategy.params.before
          ? new Date(strategy.params.before)
          : inheritedTimeRange?.before;
        const label = formatTimeRangeLabel({ after, before });
        labels.push(`Fetching ${noun} from ${label}...`);
      }
    } else if (strategy.type === "hybrid_aggregation") {
      if (strategy.params.label) {
        labels.push(`Counting messages for ${strategy.params.label}...`);
      } else {
        const after = strategy.params.after
          ? new Date(strategy.params.after)
          : inheritedTimeRange?.after;
        const before = strategy.params.before
          ? new Date(strategy.params.before)
          : inheritedTimeRange?.before;
        const timeLabel = (after || before) ? ` for ${formatTimeRangeLabel({ after, before })}` : "";
        labels.push(`Counting messages across all channels${timeLabel}...`);
      }
    } else if (strategy.type === "semantic") {
      labels.push("Searching your business data...");
    }
  }

  // Add surrounding context activity after main search activities
  if (strategies.some((s) => s.type === "surrounding_context")) {
    labels.push("Loading conversation context...");
  }

  return labels;
}

// ── Internal RAG search ───────────────────────────────────────────────────────

type RAGResult = {
  results: UnifiedResult[];
  activityLabels: string[];
  /** True when the query was a counting/ranking question — used to pick activity label */
  isAggregation: boolean;
  /** When set, the query was ambiguous across integrations — stream this question instead of searching. */
  clarifyingQuestion?: string;
};

/**
 * Detects follow-up phrases that refer back to a previous query's scope,
 * e.g. "what about the rest of the team", "show me the full list".
 * When matched, the planner message is enriched with the previous user query
 * so the planner reuses the same channels and time range.
 */
const CONTINUATION_RE =
  /\b(rest of (the )?team|everyone else|full (list|ranking|results?|breakdown)|show (me )?(all|more|the rest|everyone|the full)|all of them|what about (the others?|everyone|the rest)|other (team members?|people|channels?)|who else|what else|and (the )?rest|continue|more (people|results?|channels?)|full (ranking|breakdown|count))\b/i;

async function runInternalRAGSearch(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  workspaceId: string,
  db: ReturnType<typeof createAdminSupabaseClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeProfile: Record<string, any> | null,
  integrationManifest: IntegrationInfo[],
  businessContext?: string
): Promise<RAGResult> {
  // ── Ambiguity check: ask before searching when source is unclear ────────────
  const clarifyingQuestion = detectAmbiguousQuery(message, integrationManifest);
  if (clarifyingQuestion) {
    console.log(`[chat] ambiguous query detected — returning clarifying question`);
    return { results: [], activityLabels: [], isAggregation: false, clarifyingQuestion };
  }

  const analysis = analyzeQuery(message);
  let timeRange = analysis.timeRange;
  const { searchTerms } = analysis;

  // Inherit time range from prior messages if the current message uses a vague reference
  if (!timeRange && VAGUE_TIME_RE.test(message)) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") {
        const priorRange = analyzeQuery(history[i].content).timeRange;
        if (priorRange) {
          timeRange = priorRange;
          console.log(
            `[chat] Inherited time range from history[${i}]: ` +
              `after=${priorRange.after?.toISOString() ?? "–"} ` +
              `before=${priorRange.before?.toISOString() ?? "–"}`
          );
          break;
        }
      }
    }
  }

  const effectiveAnalysis = { ...analysis, timeRange };
  const queryText = searchTerms.length > 0 ? searchTerms.join(" ") : message;

  // ── Log 1: query analysis result ─────────────────────────────────────────────
  console.log(
    `[chat:analyze] isAggregation=${effectiveAnalysis.isAggregation} ` +
    `isComparison=${effectiveAnalysis.isComparison} ` +
    `comparisonPeriods=${effectiveAnalysis.comparisonPeriods ? effectiveAnalysis.comparisonPeriods.map((p: ComparisonPeriod) => p.label).join(" vs ") : "none"} ` +
    `isBroadSummary=${effectiveAnalysis.isBroadSummary} ` +
    `timeRange=${timeRange ? `after=${timeRange.after?.toISOString() ?? "–"} before=${timeRange.before?.toISOString() ?? "–"}` : "none"} ` +
    `message="${message.slice(0, 100)}"`
  );

  // ── Continuation enrichment ─────────────────────────────────────────────────
  // When the user asks a follow-up like "show me the full list" or "what about
  // the rest of the team", find the most recent non-continuation user message
  // and prepend it so the planner reuses the same channels and time range.
  let plannerMessage = message;
  if (CONTINUATION_RE.test(message)) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user" && !CONTINUATION_RE.test(history[i].content)) {
        plannerMessage = `${history[i].content} — follow-up: ${message}`;
        console.log(`[chat] continuation detected — enriched planner query: "${plannerMessage}"`);
        break;
      }
    }
  }

  // ── Log 2: what the planner receives ─────────────────────────────────────────
  console.log(
    `[chat:planner-in] isAggregation=${effectiveAnalysis.isAggregation} ` +
    `plannerMessage="${plannerMessage.slice(0, 120)}"`
  );

  // Run planner and embedding in parallel to minimise latency
  const [plan, queryEmbedding] = await Promise.all([
    planQuery({
      message: plannerMessage,
      knowledgeProfile,
      conversationHistory: history,
      queryAnalysis: effectiveAnalysis,
      integrationManifest,
      businessContext,
    }),
    createEmbedding(message),
  ]);

  // ── Log 3: raw planner output ─────────────────────────────────────────────────
  console.log(
    `[chat:planner-out] strategies=${JSON.stringify(
      plan.strategies.map((s) => ({
        type: s.type,
        source_types: s.params.source_types ?? null,
        dedicated_channels: s.params.dedicated_channels ?? [],
        keywords: s.params.keywords ?? [],
      }))
    )} isFallback=${plan.isFallback} reasoning="${plan.reasoning}"`
  );

  // Override 1: planner fallback + broad summary → broad_fetch
  let effectivePlan = plan;
  if (plan.isFallback && effectiveAnalysis.isBroadSummary && timeRange) {
    effectivePlan = {
      strategies: [
        {
          type: "broad_fetch",
          params: {
            after: timeRange.after?.toISOString(),
            before: timeRange.before?.toISOString(),
          },
        },
      ],
      reasoning: "Broad summary with time range — chronological fetch",
    };
    console.log(`[chat] planner fallback → broad_fetch override for: "${message}"`);
  }

  // Override 2: comparison query — build a two-period plan directly from the
  // extracted periods so we always fetch both sides simultaneously.
  // We also harvest any channel/keyword intelligence the planner already identified
  // (from its raw output) and carry it into both period strategies.
  if (effectiveAnalysis.isComparison && effectiveAnalysis.comparisonPeriods) {
    const [p1, p2] = effectiveAnalysis.comparisonPeriods;
    const isAgg = effectiveAnalysis.isAggregation;
    const stratType = isAgg ? "hybrid_aggregation" : "broad_fetch";

    // Harvest channel/keyword/source_type intelligence from the raw planner output
    const plannerHybrid = plan.strategies.find((s) => s.type === "hybrid_aggregation");
    const plannerChannels =
      plannerHybrid?.params.dedicated_channels ??
      plan.strategies
        .filter((s) => s.type === "channel_search" && s.params.channel_name)
        .map((s) => s.params.channel_name!);
    const plannerKeywords =
      plannerHybrid?.params.keywords ?? effectiveAnalysis.searchTerms.slice(0, 8);
    // Carry source_types: check hybrid first, then any other strategy that has them
    const plannerSourceTypesComp =
      plannerHybrid?.params.source_types ??
      plan.strategies.find((s) => s.params.source_types?.length)?.params.source_types;

    const baseParams = isAgg
      ? {
          dedicated_channels: plannerChannels,
          keywords: plannerKeywords,
          ...(plannerSourceTypesComp?.length ? { source_types: plannerSourceTypesComp } : {}),
        }
      : {};

    effectivePlan = {
      strategies: [
        {
          type: stratType,
          params: {
            ...baseParams,
            label: p1.label,
            after: p1.after?.toISOString(),
            before: p1.before?.toISOString(),
          },
        },
        {
          type: stratType,
          params: {
            ...baseParams,
            label: p2.label,
            after: p2.after?.toISOString(),
            before: p2.before?.toISOString(),
          },
        },
      ],
      reasoning: `Comparison query — ${stratType} for "${p1.label}" and "${p2.label}"`,
    };
    console.log(
      `[chat:comparison] two-period plan: [${p1.label}] vs [${p2.label}] ` +
      `strategy=${stratType} channels=[${plannerChannels.join(",")}]`
    );
  }

  // Override 3: aggregation/counting question and plan has no hybrid_aggregation →
  // force hybrid_aggregation regardless of what the planner chose (it may have
  // picked channel_search, broad_fetch, or semantic — none are accurate for counting).
  // Skip if comparison override (Override 2) already built a two-period plan,
  // since that plan already uses the right strategy type.
  if (
    effectiveAnalysis.isAggregation &&
    !effectiveAnalysis.isComparison &&
    !effectivePlan.strategies.some((s) => s.type === "hybrid_aggregation")
  ) {
    // Carry forward any channels the planner identified so the SQL call is targeted
    const plannerChannels = effectivePlan.strategies
      .filter((s) => s.type === "channel_search" && s.params.channel_name)
      .map((s) => s.params.channel_name!);

    // Carry forward source_types the planner specified on any of its strategies
    const plannerSourceTypesAgg = [
      ...new Set(effectivePlan.strategies.flatMap((s) => s.params.source_types ?? [])),
    ];

    // Use search terms as keyword fallback for non-dedicated channels
    const keywordFallback = effectiveAnalysis.searchTerms.slice(0, 10);

    const overriddenFrom = effectivePlan.strategies.map((s) => s.type).join(",");
    effectivePlan = {
      strategies: [
        {
          type: "hybrid_aggregation",
          params: {
            dedicated_channels: plannerChannels,
            keywords: keywordFallback,
            after: timeRange?.after?.toISOString(),
            before: timeRange?.before?.toISOString(),
            ...(plannerSourceTypesAgg.length ? { source_types: plannerSourceTypesAgg } : {}),
          },
        },
      ],
      reasoning: `Counting/ranking — upgraded from [${overriddenFrom}] to hybrid_aggregation`,
    };
    console.log(
      `[chat:agg-safeguard] isAggregation=true, plan was [${overriddenFrom}] → hybrid_aggregation ` +
      `source_types=[${plannerSourceTypesAgg.join(",")}] ` +
      `dedicated_channels=[${plannerChannels.join(",")}] keywords=[${keywordFallback.join(",")}]`
    );
  } else if (effectiveAnalysis.isAggregation) {
    // Planner already chose hybrid_aggregation — log its source_types for diagnostics
    const existingHybrid = effectivePlan.strategies.find((s) => s.type === "hybrid_aggregation");
    console.log(
      `[chat:agg-safeguard] isAggregation=true, planner already output hybrid_aggregation ` +
      `source_types=[${(existingHybrid?.params.source_types ?? []).join(",")}] — no override needed`
    );
  }

  // ── Log 4: final effective plan before executor ───────────────────────────────
  console.log(
    `[chat:executor-in] final strategies=${JSON.stringify(
      effectivePlan.strategies.map((s) => ({
        type: s.type,
        source_types: s.params.source_types ?? null,
        dedicated_channels: s.params.dedicated_channels ?? [],
      }))
    )} reasoning="${effectivePlan.reasoning}"`
  );

  const activityLabels = getStrategyActivityLabels(
    effectivePlan.strategies,
    timeRange
  );

  // ── Log 5: executor output ────────────────────────────────────────────────────
  // (logged inside executeStrategies per-strategy, then here after all finish)
  const results = await executeStrategies({
    strategies: effectivePlan.strategies,
    workspaceId,
    queryEmbedding,
    queryText,
    adminSupabase: db,
  });

  const hasCountResult = results.some((r) => r.source_type === "aggregation_counts");
  console.log(
    `[chat:executor-out] ${results.length} results, hasCountResult=${hasCountResult}, ` +
    `isAggregation=${effectiveAnalysis.isAggregation}`
  );
  return { results, activityLabels, isAggregation: effectiveAnalysis.isAggregation };
}

// ── Context string builders ───────────────────────────────────────────────────

/** Renders one UnifiedResult as a [Source: ...] block. */
function renderResultBlock(r: UnifiedResult): string {
  const meta = r.metadata ?? {};
  const srcParts: string[] = [r.source_type];
  const ch = getChannelName(r.source_type, meta);
  if (ch) srcParts.push(ch);
  const usr = getUserName(r.source_type, meta);
  if (usr) srcParts.push(usr);
  const dt = formatSourceDate(meta);
  if (dt) srcParts.push(dt);
  // For person_search results: tell CleverBrain whether this is a message
  // FROM the person or a message that merely mentions them.
  if (r.match_type === "mentioned") srcParts.push("person_mentioned_not_author");
  return `[Source: ${srcParts.join(" | ")}]\n${r.chunk_text}`;
}

function buildInternalContext(results: UnifiedResult[]): string {
  // Aggregation counts go first as plain structured data (no source header).
  // Multiple count rows when it's a comparison query (one per period).
  const countResults = results.filter((r) => r.source_type === "aggregation_counts");
  const regularResults = results.filter((r) => r.source_type !== "aggregation_counts");

  const parts: string[] = [];

  if (countResults.length > 0) {
    parts.push(countResults.map((r) => r.chunk_text).join("\n\n"));
  }

  if (regularResults.length > 0) {
    // Detect comparison mode: multiple distinct period labels
    const periodLabels = [
      ...new Set(
        regularResults
          .map((r) => r.metadata?.period_label as string | undefined)
          .filter(Boolean)
      ),
    ] as string[];

    if (periodLabels.length > 1) {
      // Comparison mode: render each period as a clearly labelled section
      const sampleHeader =
        countResults.length > 0
          ? `MESSAGE SAMPLE (qualitative context for both periods):\n`
          : "";
      const periodSections = periodLabels.map((label) => {
        const periodResults = regularResults.filter(
          (r) => (r.metadata?.period_label as string | undefined) === label
        );
        const rendered = periodResults.map(renderResultBlock).join("\n\n---\n\n");
        return `PERIOD: ${label} (${periodResults.length} messages)\n${rendered}`;
      });
      // Any unlabelled results (shouldn't happen in comparison mode but handle gracefully)
      const unlabelled = regularResults.filter(
        (r) => !(r.metadata?.period_label as string | undefined)
      );
      if (unlabelled.length > 0) {
        periodSections.push(unlabelled.map(renderResultBlock).join("\n\n---\n\n"));
      }
      parts.push(sampleHeader + periodSections.join("\n\n===\n\n"));
    } else {
      // Normal (single-period) mode
      const sampleHeader =
        countResults.length > 0
          ? `MESSAGE SAMPLE (${regularResults.length} messages — qualitative context):\n`
          : "";
      parts.push(sampleHeader + regularResults.map(renderResultBlock).join("\n\n---\n\n"));
    }
  }

  return parts.join("\n\n===\n\n");
}

function buildWebContext(webResults: WebResult[]): string {
  if (!webResults.length) return "";
  return (
    "WEB SEARCH RESULTS:\n" +
    "The following information was found on the web. Use it to supplement your answer.\n\n" +
    webResults
      .map((r) => `[Source: ${r.title} | ${r.url}]\n${r.content}`)
      .join("\n\n")
  );
}

function buildContextString(
  searchResults: UnifiedResult[],
  webResults: WebResult[]
): string {
  const hasBoth = searchResults.length > 0 && webResults.length > 0;

  const parts: string[] = [];

  if (searchResults.length > 0) {
    const block = buildInternalContext(searchResults);
    parts.push(hasBoth ? `YOUR BUSINESS DATA:\n${block}` : block);
  }

  if (webResults.length > 0) {
    parts.push(buildWebContext(webResults));
  }

  return (
    parts.join("\n\n===\n\n") ||
    "No relevant data was found in your connected integrations for this query."
  );
}

// ── Web query enrichment ──────────────────────────────────────────────────────

const QUERY_SKIP_WORDS = new Set([
  "what", "when", "why", "how", "did", "was", "is", "are", "the", "a", "an",
  "in", "of", "to", "for", "about", "any", "do", "does", "our", "their",
  "has", "have", "been", "will", "can", "could", "would", "should", "its",
  "this", "that", "these", "those", "really", "actually", "still", "last",
  "first", "just", "also", "even", "tell", "me", "us", "you", "your", "it",
]);

/**
 * If the web query is fewer than 4 words, scan the last 3 user messages for
 * topic words that are missing from the query and prepend them.
 * This prevents follow-up questions from losing their subject context.
 */
function enrichWebQuery(
  webQuery: string,
  history: Array<{ role: string; content: string }>
): string {
  const queryWords = webQuery.trim().split(/\s+/);
  if (queryWords.length >= 4) return webQuery;

  const priorUserMessages = history
    .filter((m) => m.role === "user")
    .slice(-3)
    .reverse(); // most recent first

  for (const prior of priorUserMessages) {
    const topicWords = prior.content
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !QUERY_SKIP_WORDS.has(w.toLowerCase()));

    if (topicWords.length === 0) continue;

    const lowerQuery = webQuery.toLowerCase();
    const newWords = topicWords.filter(
      (w) => !lowerQuery.includes(w.toLowerCase())
    );

    if (newWords.length > 0) {
      const enriched = `${newWords.slice(0, 3).join(" ")} ${webQuery}`.trim();
      console.log(
        `[chat] web_query enriched: "${webQuery}" → "${enriched}"`
      );
      return enriched;
    }
  }

  return webQuery;
}

// ── Role update helpers ───────────────────────────────────────────────────────

const ROLE_UPDATE_RE = /\[ROLE_UPDATE:\s*name=([^,\]]+),\s*role=([^\]]+)\]/i;

/** Strip all [ROLE_UPDATE: ...] tags from a response string. */
function stripRoleUpdateTag(text: string): string {
  return text.replace(/\[ROLE_UPDATE:[^\]]*\]/gi, "").trimEnd();
}

/**
 * Parse, apply, and persist a role update extracted from the assistant response.
 * Silently no-ops on any error so the main response stream is never blocked.
 */
async function applyRoleUpdate(
  rawMatch: RegExpMatchArray,
  workspaceId: string,
  db: ReturnType<typeof createAdminSupabaseClient>
): Promise<void> {
  const personName = rawMatch[1].trim();
  const newRole = rawMatch[2].trim();
  if (!personName || !newRole) return;

  try {
    const { data: profileRow } = await db
      .from("knowledge_profiles")
      .select("profile, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!profileRow?.profile) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = profileRow.profile as Record<string, any>;
    const members: Array<{
      name?: string;
      detected_role?: string;
      likely_role?: string;
      confidence?: string;
      active_channels?: string[];
      typical_activities?: string;
      notes?: string;
    }> = profile.team_members ?? [];

    const lowerTarget = personName.toLowerCase();
    let matched = false;

    const updated = members.map((m) => {
      if (!m.name) return m;
      const lowerName = m.name.toLowerCase();
      if (lowerName.includes(lowerTarget) || lowerTarget.includes(lowerName)) {
        matched = true;
        return { ...m, detected_role: newRole, confidence: "confirmed" };
      }
      return m;
    });

    // If no existing member matched, add a new entry
    if (!matched) {
      updated.push({
        name: personName,
        detected_role: newRole,
        confidence: "confirmed",
        active_channels: [],
        typical_activities: "",
        notes: "Added via conversation",
      });
    }

    const newProfile = { ...profile, team_members: updated };
    const { error } = await db.rpc("upsert_knowledge_profile", {
      p_workspace_id: workspaceId,
      p_profile: newProfile,
      p_status: "ready",
    });

    if (error) {
      console.error("[chat] role-update save failed:", error.message);
    } else {
      console.log(
        `[chat] role-update applied: ${personName} → "${newRole}" (${matched ? "updated" : "added"})`
      );
    }
  } catch (err) {
    console.error("[chat] applyRoleUpdate error:", err);
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // ── Auth (cookie-based, verify session only) ──────────────────────────────
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { message?: string; workspaceId?: string; conversationId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, workspaceId, conversationId: inputConversationId } = body;
  if (!message?.trim() || !workspaceId) {
    return new Response(
      JSON.stringify({ error: "message and workspaceId are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Verify workspace membership ───────────────────────────────────────────
  const { data: membership } = await authClient
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Admin client for all remaining DB ops ─────────────────────────────────
  const db = createAdminSupabaseClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  // ── Fetch workspace/onboarding/profile/integrations + run intent router ──
  const [
    { data: workspaceRow },
    { data: onboardingRow },
    { data: profileRow },
    { data: integrationsRows },
    routing,
  ] = await Promise.all([
    db.from("workspaces").select("name, settings").eq("id", workspaceId).single(),
    db
      .from("onboarding_state")
      .select("org_data, skyler_data")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("knowledge_profiles")
      .select("profile, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("integrations")
      .select("provider")
      .eq("workspace_id", workspaceId)
      .eq("status", "connected"),
    classifyIntent({
      message,
      knowledgeProfile: null,
      conversationHistory: [],
    }),
  ]);

  // Build the integration manifest from connected providers
  const connectedProviders = ((integrationsRows ?? []) as IntegrationRow[]).map(
    (r) => r.provider
  );
  const integrationManifest: IntegrationInfo[] =
    buildIntegrationManifest(connectedProviders);
  console.log(
    `[chat] connected integrations: [${connectedProviders.join(", ")}]`
  );

  const ws = workspaceRow as WorkspaceRow | null;
  const businessContext =
    (ws?.settings?.business_context as string | undefined)?.trim() || undefined;

  const systemPrompt = buildSystemPrompt(
    ws,
    onboardingRow as OnboardingRow | null,
    profileRow as KnowledgeProfileRow | null
  );

  // Fix 1: Override system prompt for general knowledge to prevent the model
  // from mentioning data searches that never happened.
  const effectiveSystemPrompt =
    routing.intent === "general_knowledge"
      ? systemPrompt +
        "\n\nThis is a general knowledge question. Answer directly from your training knowledge. Do NOT mention searching the user's data, connected systems, or available context. Do NOT say 'I couldn't find that in the available data.' Just answer the question naturally. If relevant, relate it back to their business context."
      : systemPrompt;

  const knowledgeProfile =
    (profileRow as KnowledgeProfileRow | null)?.profile ?? null;

  // Profile is "sufficient" if the row is ready (or pending_review) and non-empty
  const profileStatus = (profileRow as KnowledgeProfileRow | null)?.status;
  const profileReady =
    (profileStatus === "ready" || profileStatus === "pending_review") &&
    Object.keys(
      ((profileRow as KnowledgeProfileRow | null)?.profile as Record<
        string,
        unknown
      >) ?? {}
    ).length > 0;
  const effectiveProfileSufficient =
    routing.profile_sufficient && profileReady;

  let conversationId: string | null = inputConversationId ?? null;
  let isNewConversation = false;

  const responseStream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        // ── Step 1: Conversation management ─────────────────────────────────
        if (!conversationId) {
          isNewConversation = true;
          const { data: newConvId, error: convError } = await db.rpc(
            "create_conversation",
            {
              p_workspace_id: workspaceId,
              p_user_id: user.id,
              p_title: "New conversation",
            }
          );
          if (convError || !newConvId) {
            throw new Error(
              `Failed to create conversation: ${convError?.message ?? "null id returned"}`
            );
          }
          conversationId = newConvId as string;
        }

        await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "user",
          p_content: message,
          p_sources: null,
        });

        // ── Step 2: Load conversation history ────────────────────────────────
        let history: Array<{ role: "user" | "assistant"; content: string }> =
          [];
        try {
          const { data: msgs } = await db.rpc("get_conversation_messages", {
            p_conversation_id: conversationId,
          });
          history = ((msgs ?? []) as HistoryMessage[])
            .slice(0, -1)
            .slice(-10)
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));
        } catch (histErr) {
          console.error("[chat] Failed to load history:", histErr);
        }

        // ── Step 3: Route based on intent ────────────────────────────────────
        let searchResults: UnifiedResult[] = [];
        let webResults: WebResult[] = [];
        const intent = routing.intent;
        // Tracks whether an internal RAG search was performed so we know
        // whether to run the agentic evaluation loop afterward.
        let didInternalSearch = false;
        // Tracks whether the query was a counting/ranking question
        let ragIsAggregation = false;
        // When set, the query was ambiguous — stream this question instead of calling Claude
        let clarifyingQuestion: string | null = null;

        console.log(`[chat] intent=${intent} routing for: "${message}"`);

        if (intent === "conversational") {
          // ── Conversational: no activity, no search ─────────────────────────

        } else if (intent === "general_knowledge") {
          // ── General knowledge: Claude answers from training data ────────────
          send({ type: "activity", action: "Thinking..." });

        } else if (intent === "web_search") {
          // ── Web search: query Tavily for external information ───────────────
          // Fix 2: enrich short queries with topic context from history
          const webQuery = enrichWebQuery(routing.web_query ?? message, history);
          send({ type: "activity", action: "Searching the web..." });
          webResults = await searchWeb(webQuery);
          console.log(`[chat] web search (${webQuery}) → ${webResults.length} results`);

        } else if (intent === "internal_data") {
          // ── Internal data: multi-strategy RAG (or profile alone if sufficient)
          if (!effectiveProfileSufficient) {
            const rag = await runInternalRAGSearch(
              message, history, workspaceId, db, knowledgeProfile, integrationManifest, businessContext
            );
            if (rag.clarifyingQuestion) {
              clarifyingQuestion = rag.clarifyingQuestion;
            } else {
              for (const label of rag.activityLabels) {
                send({ type: "activity", action: label });
              }
              searchResults = rag.results;
              ragIsAggregation = rag.isAggregation;
              didInternalSearch = true;
            }
          }

        } else if (intent === "hybrid") {
          // ── Hybrid: internal RAG + web search in parallel ───────────────────
          // Fix 2: enrich short queries with topic context from history
          const hybridWebQuery = enrichWebQuery(routing.web_query ?? message, history);
          const [ragResult, webRes] = await Promise.all([
            runInternalRAGSearch(message, history, workspaceId, db, knowledgeProfile, integrationManifest, businessContext),
            searchWeb(hybridWebQuery),
          ]);
          if (ragResult.clarifyingQuestion) {
            clarifyingQuestion = ragResult.clarifyingQuestion;
          } else {
            for (const label of ragResult.activityLabels) {
              send({ type: "activity", action: label });
            }
            if (webRes.length > 0) {
              send({ type: "activity", action: "Searching the web..." });
            }
            searchResults = ragResult.results;
            ragIsAggregation = ragResult.isAggregation;
            webResults = webRes;
            didInternalSearch = true;
            console.log(
              `[chat] hybrid — internal: ${searchResults.length}, web: ${webResults.length}`
            );
          }

        } else if (intent === "creative") {
          // ── Creative: generate content, optionally enriched with internal data
          if (routing.search_needed) {
            const rag = await runInternalRAGSearch(
              message, history, workspaceId, db, knowledgeProfile, integrationManifest, businessContext
            );
            if (rag.clarifyingQuestion) {
              clarifyingQuestion = rag.clarifyingQuestion;
            } else {
              for (const label of rag.activityLabels) {
                send({ type: "activity", action: label });
              }
              searchResults = rag.results;
              ragIsAggregation = rag.isAggregation;
              didInternalSearch = true;
            }
          }
        }

        // Round 1 reading activity
        if (searchResults.length > 0) {
          const hasExactCounts = searchResults.some(
            (r) => r.source_type === "aggregation_counts"
          );
          const sampleCount = searchResults.filter(
            (r) => r.source_type !== "aggregation_counts"
          ).length;
          send({
            type: "activity",
            action: hasExactCounts
              ? `Analyzing counts and reading ${sampleCount} sample messages...`
              : ragIsAggregation
              ? `Counting and ranking across ${searchResults.length} messages...`
              : `Reading ${searchResults.length} relevant messages...`,
          });
        }

        // ── Agentic loop: up to 2 follow-up search rounds ────────────────────
        // Only runs when an internal RAG search was performed.
        // Max 3 total rounds (initial + 2 follow-ups); stops early if we
        // already have ≥100 chunks or the context is evaluated as sufficient.
        if (didInternalSearch) {
          const MAX_FOLLOW_UPS = 2;
          const CHUNK_CAP = 100;

          for (let round = 0; round < MAX_FOLLOW_UPS; round++) {
            if (searchResults.length >= CHUNK_CAP) {
              console.log(
                `[chat] agentic loop: ${searchResults.length} chunks — cap reached, stopping`
              );
              break;
            }

            const evaluation = await evaluateContext({
              message,
              chunks: searchResults,
              knowledgeProfile,
              conversationHistory: history,
            });

            if (evaluation.sufficient) {
              console.log(`[chat] agentic round ${round + 2}: sufficient`);
              break;
            }
            if (!evaluation.strategies.length) {
              console.log(
                `[chat] agentic round ${round + 2}: not sufficient but no follow-up strategies`
              );
              break;
            }

            const roundLabel =
              round === 0 ? "Searching for more context..." : "Expanding search...";
            send({ type: "activity", action: roundLabel });

            // Compute embedding only if a semantic strategy is planned
            const semanticStrategy = evaluation.strategies.find(
              (s) => s.type === "semantic"
            );
            const followUpQuery = semanticStrategy?.params.query ?? message;
            const followUpEmbedding = semanticStrategy
              ? await createEmbedding(followUpQuery)
              : [];

            const newResults = await executeStrategies({
              strategies: evaluation.strategies,
              workspaceId,
              queryEmbedding: followUpEmbedding,
              queryText: followUpQuery,
              adminSupabase: db,
              // Lets surrounding_context-only plans enrich the current results
              seedResults: searchResults,
            });

            if (!newResults.length) {
              console.log(`[chat] agentic round ${round + 2}: no new results`);
              break;
            }

            // Merge, deduplicating by chunk_id
            const seen = new Map(searchResults.map((r) => [r.chunk_id, r]));
            let added = 0;
            for (const r of newResults) {
              if (!seen.has(r.chunk_id)) {
                seen.set(r.chunk_id, r);
                added++;
              }
            }

            if (added === 0) {
              console.log(`[chat] agentic round ${round + 2}: all results already seen`);
              break;
            }

            searchResults = [...seen.values()].sort((a, b) => {
              const tsA = a.msg_ts ? new Date(a.msg_ts).getTime() : Infinity;
              const tsB = b.msg_ts ? new Date(b.msg_ts).getTime() : Infinity;
              return tsA - tsB;
            });

            send({
              type: "activity",
              action: `Found ${added} additional messages...`,
            });
            console.log(
              `[chat] agentic round ${round + 2}: +${added} chunks, total=${searchResults.length}`
            );
          }
        }

        // ── Step 4: Build context block ──────────────────────────────────────
        const context = buildContextString(searchResults, webResults);

        // ── Step 5: Generating activity ──────────────────────────────────────
        if (intent !== "conversational" && !clarifyingQuestion) {
          send({ type: "activity", action: "Generating response..." });
        }

        // ── Step 6: Generate response (Claude or clarifying question) ────────
        let fullResponse = "";

        if (clarifyingQuestion) {
          // Short-circuit: stream the clarifying question directly, skip Claude.
          fullResponse = clarifyingQuestion;
          send({ type: "text", text: clarifyingQuestion });
        } else {
          // Fix 1: general_knowledge never gets a context block — no search ran,
          // so injecting "No relevant data found" would prime the wrong response.
          const userMessageWithContext =
            intent === "conversational" || intent === "general_knowledge"
              ? message
              : `<context>\n${context}\n</context>\n\n${message}`;

          const claudeMessages: Anthropic.MessageParam[] = [
            ...history,
            { role: "user", content: userMessageWithContext },
          ];

          const claudeStream = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            system: effectiveSystemPrompt,
            messages: claudeMessages,
            stream: true,
          });

          // ── Step 7: Stream text tokens ─────────────────────────────────────
          // We buffer the last 80 characters to catch the [ROLE_UPDATE: ...] tag
          // that may arrive split across multiple delta tokens.  Once we detect
          // the opening "[ROLE_UPDATE" in the buffer we hold back further tokens
          // until the closing "]" arrives or the stream ends, then discard the tag.
          let tagBuffer = "";          // accumulates potential tag characters
          let suppressingTag = false;  // true once "[ROLE_UPDATE" detected

          for await (const event of claudeStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const chunk = event.delta.text;
              fullResponse += chunk;

              if (suppressingTag) {
                // We are inside the tag — buffer until "]" found
                tagBuffer += chunk;
                if (tagBuffer.includes("]")) {
                  suppressingTag = false;
                  tagBuffer = "";
                }
                // Don't send anything while suppressing
              } else {
                // Check if this chunk or its tail opens a tag
                const combined = tagBuffer + chunk;
                const tagStart = combined.indexOf("[ROLE_UPDATE");
                if (tagStart !== -1) {
                  // Send everything before the tag start
                  const safe = combined.slice(0, tagStart);
                  if (safe) send({ type: "text", text: safe });
                  suppressingTag = true;
                  tagBuffer = combined.slice(tagStart);
                  // If the entire tag is already in buffer, close it immediately
                  if (tagBuffer.includes("]")) {
                    suppressingTag = false;
                    tagBuffer = "";
                  }
                } else {
                  // No tag — flush safe prefix, keep last 12 chars as lookahead
                  const LOOKAHEAD = 12;
                  const safe = combined.slice(0, Math.max(0, combined.length - LOOKAHEAD));
                  if (safe) send({ type: "text", text: safe });
                  tagBuffer = combined.slice(Math.max(0, combined.length - LOOKAHEAD));
                }
              }
            }
          }

          // Flush any remaining buffered text that wasn't a tag
          if (tagBuffer && !suppressingTag) {
            send({ type: "text", text: tagBuffer });
          }
        }

        // ── Sources (deduplicated by document_id) ────────────────────────────
        const sources = deduplicateSources(searchResults);
        send({ type: "sources", sources });

        // ── Step 8: Check for role update tag ────────────────────────────────
        const roleMatch = fullResponse.match(ROLE_UPDATE_RE);
        // Strip the tag before saving — users should never see it
        const savedContent = roleMatch
          ? stripRoleUpdateTag(fullResponse)
          : fullResponse;

        if (roleMatch) {
          // Run async, non-blocking — don't await so stream closes first
          void applyRoleUpdate(roleMatch, workspaceId, db);
        }

        // ── Step 9: Save assistant message ───────────────────────────────────
        const { data: assistantMsgId } = await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "assistant",
          p_content: savedContent,
          p_sources: sources.length > 0 ? sources : null,
        });

        send({
          type: "metadata",
          conversationId,
          messageId: assistantMsgId ?? null,
        });
        send({ type: "done" });
        controller.close();

        // ── Auto-title (non-blocking) ─────────────────────────────────────────
        if (isNewConversation && conversationId) {
          void (async () => {
            try {
              const titleRes = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 50,
                messages: [
                  {
                    role: "user",
                    content: `Generate a short, specific title (max 6 words) for a conversation based on the user's question and the assistant's response. Use names, IDs, or topics from the actual content — avoid generic titles. Return only the title, nothing else.\n\nUser question: "${message}"\n\nAssistant response (first 300 chars): "${savedContent.slice(0, 300)}"`,
                  },
                ],
              });
              const raw =
                titleRes.content[0]?.type === "text"
                  ? titleRes.content[0].text.trim().replace(/^["']|["']$/g, "")
                  : null;
              if (raw && conversationId) {
                await db
                  .from("conversations")
                  .update({ title: raw })
                  .eq("id", conversationId);
                console.log(
                  `[chat] Auto-titled conversation ${conversationId}: "${raw}"`
                );
              }
            } catch (titleErr) {
              console.error("[chat] Auto-title failed:", titleErr);
            }
          })();
        }
      } catch (err) {
        console.error("[chat] Pipeline error:", err);
        try {
          send({
            type: "error",
            error:
              err instanceof Error ? err.message : "Internal server error",
          });
        } catch {
          /* controller may already be closed */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

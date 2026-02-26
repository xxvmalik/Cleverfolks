import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { analyzeQuery } from "@/lib/query-analyzer";
import { createEmbedding } from "@/lib/embeddings";
import { classifyIntent } from "@/lib/intent-router";
import { searchWeb, type WebResult } from "@/lib/web-search";

// ── Types ─────────────────────────────────────────────────────────────────────

type KnowledgeProfileRow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: Record<string, any> | null;
  status: string | null;
};

type SearchResult = {
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_text: string;
  source_type: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

type ChronologicalResult = {
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_text: string;
  source_type: string;
  metadata: Record<string, unknown>;
  msg_ts: string | null;
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
    likely_role?: string;
    active_channels?: string[];
    typical_activities?: string;
    notes?: string;
  }> = profile.team_members ?? [];
  if (members.length > 0) {
    const lines = members
      .filter((m) => m.name)
      .map((m) => {
        const channels = (m.active_channels ?? []).join(", ");
        const extra = m.notes ? ` (${m.notes})` : "";
        return `- ${m.name} — ${m.likely_role ?? "unknown role"}. Active in ${channels || "unknown channels"}. ${m.typical_activities ?? ""}${extra}`;
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

  // ── Knowledge profile intelligence section ──────────────────────────────
  let intelligenceSection = "";
  if (
    knowledgeProfile?.status === "ready" &&
    knowledgeProfile.profile &&
    Object.keys(knowledgeProfile.profile).length > 0
  ) {
    const formatted = formatKnowledgeProfile(knowledgeProfile.profile);
    if (formatted) {
      intelligenceSection = `\nCOMPANY INTELLIGENCE (auto-generated from your connected data):\n${formatted}\n`;
    }
  }

  return `You are CleverBrain, the AI knowledge assistant for ${companyName}. You help team members find information and insights from their connected business data.
${intelligenceSection}${companySection}
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
- When using web search results, cite sources naturally: 'According to [publication]...' to distinguish external information from the company's own data.`;
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

function deduplicateSources(results: SearchResult[]): SourceInfo[] {
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

// ── Internal RAG search ───────────────────────────────────────────────────────
// Encapsulates: query analysis, vague time inheritance, broad vs hybrid search.

type RAGResult = {
  results: SearchResult[];
  activityLabel: string;
};

async function runInternalRAGSearch(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: ReturnType<typeof createAdminSupabaseClient>
): Promise<RAGResult> {
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

  const isBroad = analysis.isBroadSummary && timeRange !== null;

  if (isBroad && timeRange) {
    const label = formatTimeRangeLabel(timeRange);
    const activityLabel = `Fetching messages from ${label}...`;
    console.log(
      `[chat] broad fetch — after: ${timeRange.after?.toISOString() ?? "none"}, ` +
        `before: ${timeRange.before?.toISOString() ?? "none"}`
    );
    const { data, error } = await db.rpc("fetch_chunks_by_timerange", {
      p_workspace_id: workspaceId,
      p_after: timeRange.after ? timeRange.after.toISOString() : null,
      p_before: timeRange.before ? timeRange.before.toISOString() : null,
      p_limit: 150,
    });
    if (error) {
      console.error("[chat] fetch_chunks_by_timerange error:", error);
      return { results: [], activityLabel };
    }
    const results = ((data ?? []) as ChronologicalResult[]).map((r) => ({
      ...r,
      similarity: 0,
    }));
    return { results, activityLabel };
  } else {
    const activityLabel = "Searching your business data...";
    const queryEmbedding = await createEmbedding(message);
    if (!queryEmbedding.length) {
      console.warn("[chat] Empty embedding — skipping vector search");
      return { results: [], activityLabel };
    }
    const queryText = searchTerms.length > 0 ? searchTerms.join(" ") : message;
    console.log(
      `[chat] hybrid search — queryText: "${queryText}", ` +
        `after: ${timeRange?.after?.toISOString() ?? "none"}, ` +
        `before: ${timeRange?.before?.toISOString() ?? "none"}`
    );
    const { data, error } = await db.rpc("hybrid_search_documents", {
      p_workspace_id: workspaceId,
      p_query_embedding: `[${queryEmbedding.join(",")}]`,
      p_query_text: queryText,
      p_match_count: 15,
      p_match_threshold: 0.2,
      p_after: timeRange?.after ? timeRange.after.toISOString() : null,
      p_before: timeRange?.before ? timeRange.before.toISOString() : null,
    });
    if (error) {
      console.error("[chat] hybrid_search_documents error:", error);
      return { results: [], activityLabel };
    }
    const results = (data ?? []) as SearchResult[];
    console.log(`[chat] hybrid search returned ${results.length} results`);
    return { results, activityLabel };
  }
}

// ── Context string builders ───────────────────────────────────────────────────

function buildInternalContext(results: SearchResult[]): string {
  return results
    .map((r) => {
      const meta = r.metadata ?? {};
      const parts: string[] = [r.source_type];
      const ch = getChannelName(r.source_type, meta);
      if (ch) parts.push(ch);
      const usr = getUserName(r.source_type, meta);
      if (usr) parts.push(usr);
      const dt = formatSourceDate(meta);
      if (dt) parts.push(dt);
      return `[Source: ${parts.join(" | ")}]\n${r.chunk_text}`;
    })
    .join("\n\n---\n\n");
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
  searchResults: SearchResult[],
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

  // ── Fetch workspace/onboarding/profile + run intent router in parallel ────
  // All four operations start simultaneously; the intent router takes ~1s so
  // running it here (before the stream) means no perceived latency is added
  // once the stream begins — the routing decision is ready immediately.
  const [
    { data: workspaceRow },
    { data: onboardingRow },
    { data: profileRow },
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
    classifyIntent({
      message,
      knowledgeProfile: null, // fetched in parallel; router classifies from message alone
      conversationHistory: [], // history loaded inside stream; doesn't affect classification
    }),
  ]);

  const systemPrompt = buildSystemPrompt(
    workspaceRow as WorkspaceRow | null,
    onboardingRow as OnboardingRow | null,
    profileRow as KnowledgeProfileRow | null
  );

  // Profile is only "sufficient" if the row is ready and non-empty
  const profileReady =
    (profileRow as KnowledgeProfileRow | null)?.status === "ready" &&
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
        let searchResults: SearchResult[] = [];
        let webResults: WebResult[] = [];
        const intent = routing.intent;

        console.log(`[chat] intent=${intent} routing for: "${message}"`);

        if (intent === "conversational") {
          // ── Conversational: no activity, no search ─────────────────────────
          // Respond instantly from the system prompt + history alone

        } else if (intent === "general_knowledge") {
          // ── General knowledge: Claude answers from training data ────────────
          send({ type: "activity", action: "Thinking..." });

        } else if (intent === "web_search") {
          // ── Web search: query Tavily for external information ───────────────
          const webQuery = routing.web_query ?? message;
          send({ type: "activity", action: "Searching the web..." });
          webResults = await searchWeb(webQuery);
          console.log(`[chat] web search (${webQuery}) → ${webResults.length} results`);

        } else if (intent === "internal_data") {
          // ── Internal data: RAG search (or profile alone if sufficient) ───────
          if (!effectiveProfileSufficient) {
            const rag = await runInternalRAGSearch(message, history, workspaceId, db);
            send({ type: "activity", action: rag.activityLabel });
            searchResults = rag.results;
          }
          // else: profile already injected into system prompt — no search needed

        } else if (intent === "hybrid") {
          // ── Hybrid: internal RAG + web search in parallel ───────────────────
          send({ type: "activity", action: "Searching your business data..." });
          send({ type: "activity", action: "Searching the web..." });
          const [ragResult, webRes] = await Promise.all([
            runInternalRAGSearch(message, history, workspaceId, db),
            searchWeb(routing.web_query ?? message),
          ]);
          searchResults = ragResult.results;
          webResults = webRes;
          console.log(
            `[chat] hybrid — internal: ${searchResults.length}, web: ${webResults.length}`
          );

        } else if (intent === "creative") {
          // ── Creative: generate content, optionally enriched with internal data
          if (routing.search_needed) {
            send({ type: "activity", action: "Preparing context..." });
            const rag = await runInternalRAGSearch(message, history, workspaceId, db);
            searchResults = rag.results;
          }
        }

        // Reading activity (shown when we have internal results to process)
        if (searchResults.length > 0) {
          send({
            type: "activity",
            action: `Reading ${searchResults.length} relevant messages...`,
          });
        }

        // ── Step 4: Build context block ──────────────────────────────────────
        const context = buildContextString(searchResults, webResults);

        // ── Step 5: Generating activity ──────────────────────────────────────
        if (intent !== "conversational") {
          send({ type: "activity", action: "Generating response..." });
        }

        // ── Step 6: Call Claude with streaming ───────────────────────────────
        // For conversational intent we skip context to keep it light and fast.
        const userMessageWithContext =
          intent === "conversational"
            ? message
            : `<context>\n${context}\n</context>\n\n${message}`;

        const claudeMessages: Anthropic.MessageParam[] = [
          ...history,
          { role: "user", content: userMessageWithContext },
        ];

        const claudeStream = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          messages: claudeMessages,
          stream: true,
        });

        // ── Step 7: Stream text tokens ───────────────────────────────────────
        let fullResponse = "";
        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send({ type: "text", text: event.delta.text });
            fullResponse += event.delta.text;
          }
        }

        // ── Sources (deduplicated by document_id) ────────────────────────────
        const sources = deduplicateSources(searchResults);
        send({ type: "sources", sources });

        // ── Step 8: Save assistant message ───────────────────────────────────
        const { data: assistantMsgId } = await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "assistant",
          p_content: fullResponse,
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
                    content: `Generate a short title (max 6 words) for a conversation that starts with this message. Return only the title, nothing else.\n\n"${message}"`,
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

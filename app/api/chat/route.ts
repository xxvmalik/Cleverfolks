import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { analyzeQuery } from "@/lib/query-analyzer";
import { createEmbedding } from "@/lib/embeddings";

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are CleverBrain, the AI knowledge assistant for Cleverfolks. You help team members find information and insights from their connected business data.

RULES:
- Answer based on the provided context from connected integrations (Slack messages, emails, documents, etc.)
- If context contains relevant information, give a clear, helpful answer
- If context doesn't have enough information, say so honestly — never make things up
- Reference sources naturally: 'In #product-channel, Sarah mentioned...' or 'Based on a Slack conversation from Feb 20...'
- Keep responses concise and actionable
- Use markdown formatting for readability when helpful
- When synthesizing across multiple messages, organize the information clearly
- If the user asks a follow-up, use conversation history to understand context`;

// ── Types ────────────────────────────────────────────────────────────────────
type SearchResult = {
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_text: string;
  source_type: string;
  metadata: Record<string, unknown>;
  similarity: number;
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

// ── Context helpers ───────────────────────────────────────────────────────────

function getChannelName(sourceType: string, meta: Record<string, unknown>): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply" || sourceType === "slack_reaction") {
    const ch = (meta.channel_id as string | undefined) ?? "";
    return ch ? `#${ch}` : "";
  }
  return "";
}

function getUserName(sourceType: string, meta: Record<string, unknown>): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply") {
    return (meta.user as string | undefined) ?? "";
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
    // Slack timestamps are unix epoch strings like "1708435200.123456"
    const asFloat = parseFloat(raw);
    const d = !isNaN(asFloat) && asFloat > 1_000_000_000
      ? new Date(asFloat * 1000)
      : new Date(raw);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // ── Auth (cookie-based, verify session only) ──────────────────────────────
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { message?: string; workspaceId?: string; conversationId?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, workspaceId, conversationId: inputConversationId } = body;
  if (!message?.trim() || !workspaceId) {
    return new Response(JSON.stringify({ error: "message and workspaceId are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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

  // ── Switch to admin client for all remaining DB ops (SSE breaks cookies) ──
  const db = createAdminSupabaseClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  // Captured by the stream closure — set during pipeline execution
  let conversationId: string | null = inputConversationId ?? null;
  let isNewConversation = false;

  const responseStream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // ── Step 1: Conversation management ─────────────────────────────────
        if (!conversationId) {
          isNewConversation = true;
          const { data: newConvId, error: convError } = await db.rpc("create_conversation", {
            p_workspace_id: workspaceId,
            p_user_id: user.id,
            p_title: "New conversation",
          });
          if (convError || !newConvId) {
            throw new Error(`Failed to create conversation: ${convError?.message ?? "null id returned"}`);
          }
          conversationId = newConvId as string;
        }

        await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "user",
          p_content: message,
          p_sources: null,
        });

        // ── Step 2: Query analysis ───────────────────────────────────────────
        const { timeRange, searchTerms } = analyzeQuery(message);

        // ── Activity: searching (sent BEFORE the actual search starts) ───────
        send({ type: "activity", action: "Searching your business data..." });

        // ── Step 3: Embed query ──────────────────────────────────────────────
        const queryEmbedding = await createEmbedding(message);
        console.log(`[chat] embedding length: ${queryEmbedding.length}`);

        // ── Step 4: Hybrid search ────────────────────────────────────────────
        let searchResults: SearchResult[] = [];
        if (queryEmbedding.length > 0) {
          try {
            const queryText = searchTerms.length > 0 ? searchTerms.join(" ") : message;
            console.log(`[chat] searching — queryText: "${queryText}", threshold: 0.2`);
            const { data: results, error: searchError } = await db.rpc(
              "hybrid_search_documents",
              {
                p_workspace_id: workspaceId,
                p_query_embedding: `[${queryEmbedding.join(",")}]`,
                p_query_text: queryText,
                p_match_count: 15,
                p_match_threshold: 0.2,
                p_after:  timeRange?.after  ? timeRange.after.toISOString()  : null,
                p_before: timeRange?.before ? timeRange.before.toISOString() : null,
              }
            );
            if (searchError) {
              console.error("[chat] hybrid_search_documents error:", searchError);
            } else {
              searchResults = (results ?? []) as SearchResult[];
              console.log(`[chat] search returned ${searchResults.length} results`);
            }
          } catch (searchErr) {
            console.error("[chat] Search threw — continuing without results:", searchErr);
          }
        } else {
          console.warn("[chat] Empty embedding from Voyage — skipping vector search");
        }

        // ── Activity: reading results (only if search found something) ───────
        if (searchResults.length > 0) {
          send({ type: "activity", action: `Reading ${searchResults.length} relevant messages...` });
        }

        // ── Step 5: Load conversation history ────────────────────────────────
        let history: Array<{ role: "user" | "assistant"; content: string }> = [];
        try {
          const { data: msgs } = await db.rpc("get_conversation_messages", {
            p_conversation_id: conversationId,
          });
          // get_conversation_messages returns all messages ordered by created_at ASC.
          // The last entry is the user message we just saved — exclude it, take prev 10.
          history = ((msgs ?? []) as HistoryMessage[])
            .slice(0, -1)
            .slice(-10)
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
        } catch (histErr) {
          console.error("[chat] Failed to load conversation history:", histErr);
        }

        // ── Step 6: Build context block ──────────────────────────────────────
        let context: string;
        if (searchResults.length === 0) {
          context = "No relevant data was found in your connected integrations for this query.";
        } else {
          context = searchResults
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

        // ── Activity: generating (sent BEFORE Claude API call) ───────────────
        send({ type: "activity", action: "Generating response..." });

        // ── Step 7: Call Claude API with streaming ───────────────────────────
        const userMessageWithContext = `<context>\n${context}\n</context>\n\n${message}`;

        const claudeMessages: Anthropic.MessageParam[] = [
          ...history,
          { role: "user", content: userMessageWithContext },
        ];

        const claudeStream = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: claudeMessages,
          stream: true,
        });

        // ── Step 8: Stream text tokens as SSE ───────────────────────────────
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

        // ── Step 9: Save assistant message to DB ─────────────────────────────
        const { data: assistantMsgId } = await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "assistant",
          p_content: fullResponse,
          p_sources: sources.length > 0 ? sources : null,
        });

        // ── Metadata + done ──────────────────────────────────────────────────
        send({ type: "metadata", conversationId, messageId: assistantMsgId ?? null });
        send({ type: "done" });
        controller.close();

        // ── Section B: Auto-title (non-blocking, fires after stream closes) ──
        if (isNewConversation && conversationId) {
          void (async () => {
            try {
              const titleRes = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 50,
                messages: [{
                  role: "user",
                  content:
                    `Generate a short title (max 6 words) for a conversation that starts with this message. Return only the title, nothing else.\n\n"${message}"`,
                }],
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
                console.log(`[chat] Auto-titled conversation ${conversationId}: "${raw}"`);
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
            error: err instanceof Error ? err.message : "Internal server error",
          });
        } catch {
          // controller may already be closed or enqueue may throw — ignore
        }
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

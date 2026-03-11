import { NextRequest, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  buildIntegrationManifest,
  type IntegrationInfo,
} from "@/lib/integrations-manifest";
import { runAgentLoop, type SSEEvent } from "@/lib/cleverbrain/agent-loop";
import {
  buildSkylerSystemPrompt,
  type WorkspaceRow,
  type OnboardingRow,
  type KnowledgeProfileRow,
} from "@/lib/skyler/system-prompt";
import { SKYLER_TOOLS } from "@/lib/skyler/tools";
import { executeSkylerToolCall } from "@/lib/skyler/tool-handlers";
import type { UnifiedResult } from "@/lib/strategy-executor";
import {
  retrieveMemories,
  saveMemory,
  getAllMemoryContents,
} from "@/lib/cleverbrain/memory-store";
import { extractMemories } from "@/lib/cleverbrain/memory-extractor";
import { embedChatHistory } from "@/lib/cleverbrain/chat-embedder";
import { summarizeConversation } from "@/lib/cleverbrain/conversation-summary";
import { sanitizeErrorForUser } from "@/lib/ai-error-handler";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type IntegrationRow = {
  provider: string;
};

// ── Source helpers (shared logic with CleverBrain) ────────────────────────────

function getChannelName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply") {
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
  if (sourceType === "cleverbrain_chat") return "CleverBrain conversation";
  if (sourceType.startsWith("hubspot_")) {
    const label = sourceType.replace("hubspot_", "").replace(/^\w/, (c) => c.toUpperCase());
    return `HubSpot ${label}`;
  }
  return "";
}

function getUserName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply") {
    return (meta.user_name as string | undefined) ?? (meta.user as string | undefined) ?? "";
  }
  if (sourceType === "gmail_message") {
    return (meta.user_name as string | undefined) ?? (meta.sender_name as string | undefined) ?? (meta.from as string | undefined) ?? "";
  }
  if (sourceType === "hubspot_contact" || sourceType === "hubspot_company") {
    return (meta.name as string | undefined) ?? "";
  }
  return "";
}

function formatSourceDate(meta: Record<string, unknown>): string {
  const raw =
    (meta.date as string | undefined) ??
    (meta.ts as string | undefined) ??
    (meta.start as string | undefined) ??
    (meta.close_date as string | undefined);
  if (!raw) return "";
  try {
    const asFloat = parseFloat(raw);
    const d =
      !isNaN(asFloat) && asFloat > 1_000_000_000
        ? new Date(asFloat * 1000)
        : new Date(raw);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
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

  // ── Parse body ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: { message?: string; workspaceId?: string; conversationId?: string; pipelineContext?: any };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, workspaceId, conversationId: inputConversationId, pipelineContext } = body;
  if (!message?.trim() || !workspaceId) {
    return new Response(
      JSON.stringify({ error: "message and workspaceId are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Verify workspace membership ───────────────────────────────────────
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

  // ── Admin client for all remaining DB ops ─────────────────────────────
  const db = createAdminSupabaseClient();
  const encoder = new TextEncoder();

  // ── Fetch workspace context in parallel ───────────────────────────────
  const [
    { data: workspaceRow },
    { data: onboardingRow },
    { data: profileRow },
    { data: integrationsRows },
  ] = await Promise.all([
    db.from("workspaces").select("name, settings").eq("id", workspaceId).single(),
    db.from("onboarding_state").select("org_data, skyler_data").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("knowledge_profiles").select("profile, status").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("integrations").select("provider").eq("workspace_id", workspaceId).eq("status", "connected"),
  ]);

  const connectedProviders = ((integrationsRows ?? []) as IntegrationRow[]).map((r) => r.provider);
  const integrationManifest: IntegrationInfo[] = buildIntegrationManifest(connectedProviders);
  console.log(`[skyler-chat] connected integrations: [${connectedProviders.join(", ")}]`);

  // Retrieve memories (shared with CleverBrain)
  const memories = await retrieveMemories(db, workspaceId, message, user.id, 15);
  if (memories.length > 0) {
    console.log(`[skyler-chat] Retrieved ${memories.length} memories for query`);
  }

  // Determine autonomy level from workspace settings
  // skyler_autonomy_level controls CRM write approval (separate from skyler_sales_closer)
  const wsSettings = (workspaceRow as WorkspaceRow | null)?.settings ?? {};
  const rawAutonomy = wsSettings.skyler_autonomy_level as string | undefined;
  const autonomyLevel = rawAutonomy === "full" ? "full" as const
    : rawAutonomy === "read_only" ? "read_only" as const
    : "approval_required" as const; // default when null/undefined
  console.log(`[skyler-chat] Autonomy level resolved to: ${autonomyLevel} (raw setting: ${rawAutonomy ?? "null"})`);


  // Fetch pending actions for this conversation (for natural language approval)
  let pendingActions: Array<{ id: string; description: string }> = [];
  if (inputConversationId) {
    const { data: pendingRows } = await db
      .from("skyler_actions")
      .select("id, description")
      .eq("conversation_id", inputConversationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    pendingActions = (pendingRows ?? []).map((r: { id: string; description: string }) => ({
      id: r.id,
      description: r.description,
    }));
    if (pendingActions.length > 0) {
      console.log(`[skyler-chat] ${pendingActions.length} pending actions for conversation:`, pendingActions.map(a => `${a.id}: ${a.description}`).join("; "));
    } else {
      console.log(`[skyler-chat] No pending actions for conversation ${inputConversationId}`);
    }
  } else {
    console.log(`[skyler-chat] No conversationId provided — cannot fetch pending actions`);
  }

  let systemPrompt = buildSkylerSystemPrompt(
    workspaceRow as WorkspaceRow | null,
    onboardingRow as OnboardingRow | null,
    profileRow as KnowledgeProfileRow | null,
    integrationManifest,
    memories,
    autonomyLevel,
    pendingActions
  );

  // ── Inject pipeline feedback context if present ────────────────────────
  if (pipelineContext?.referenced_email) {
    const ctx = pipelineContext;
    const email = ctx.referenced_email;
    const emailStatus = email.status ?? (email.role === "skyler" ? "sent" : "received");
    const isPending = emailStatus === "pending";

    systemPrompt += `\n\n## PIPELINE EMAIL FEEDBACK CONTEXT
The user is giving feedback on a specific email from the Sales Closer pipeline.

Pipeline: ${ctx.contact_name} at ${ctx.company_name} (ID: ${ctx.pipeline_id})
Email referenced (${emailStatus}):
Subject: ${email.subject ?? "(no subject)"}
Content:
${email.content}

${isPending ? `This email has NOT been sent yet — it is a pending draft awaiting approval.
- Acknowledge the feedback
- Ask if they want you to redraft incorporating their feedback
- If they say yes, redraft the email with their corrections applied
- Store the feedback as a workspace memory for future leads` : `This email was already sent.
- Acknowledge the feedback and confirm you'll apply it to future leads
- Store the feedback as a workspace memory so it applies to ALL future emails
- If there's a follow-up pending for this lead, offer to incorporate the feedback in the next draft`}

IMPORTANT: Always store the user's feedback as an actionable, generalised workspace memory.
Good memory: "When emailing fitness businesses, don't mention refill guarantees unless the prospect asks about follower drops"
Bad memory: "User said don't mention refill guarantees"
`;
  }

  let conversationId: string | null = inputConversationId ?? null;
  let isNewConversation = false;

  // Hoisted state for after() callbacks
  let afterData: {
    savedContent: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    fullResponse: string;
  } | null = null;

  const responseStream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // ── Step 1: Conversation management ─────────────────────────────
        if (!conversationId) {
          isNewConversation = true;
          const { data: newConvId, error: convError } = await db.rpc(
            "create_conversation",
            {
              p_workspace_id: workspaceId,
              p_user_id: user.id,
              p_title: "New conversation",
              p_agent_type: "skyler",
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

        // ── Step 2: Load conversation history ───────────────────────────
        const FULL_HISTORY_COUNT = 15;
        let history: Array<{ role: "user" | "assistant"; content: string }> = [];
        try {
          const { data: msgs } = await db.rpc("get_conversation_messages", {
            p_conversation_id: conversationId,
          });
          const allMessages = ((msgs ?? []) as HistoryMessage[])
            .slice(0, -1)
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));

          if (allMessages.length <= FULL_HISTORY_COUNT) {
            history = allMessages;
          } else {
            const olderMessages = allMessages.slice(0, -FULL_HISTORY_COUNT);
            const recentMessages = allMessages.slice(-FULL_HISTORY_COUNT);
            const summary = await summarizeConversation(olderMessages);

            if (summary) {
              history = [
                { role: "user" as const, content: `[CONVERSATION CONTEXT: Earlier in this conversation, we discussed: ${summary}]` },
                { role: "assistant" as const, content: "Understood, I have that context." },
                ...recentMessages,
              ];
            } else {
              history = recentMessages;
            }
          }
        } catch (histErr) {
          console.error("[skyler-chat] Failed to load history:", histErr);
        }

        // ── Step 3: Run agent loop (reusing CleverBrain's) ──────────────
        // Build autonomy-aware tool executor that passes context to Skyler's handler
        const skylerToolExecutor = (
          toolName: string,
          input: Record<string, unknown>,
          wsId: string,
          adminDb: typeof db
        ) =>
          executeSkylerToolCall(
            toolName,
            input,
            wsId,
            adminDb,
            autonomyLevel,
            conversationId ?? undefined,
            user.id
          );

        // Log the exact tool names being passed to the agent loop
        console.log(`[skyler-chat] Tools passed to agent loop: [${SKYLER_TOOLS.map(t => t.name).join(", ")}]`);
        console.log(`[skyler-chat] Autonomy level: ${autonomyLevel}`);

        const agentResult = await runAgentLoop(
          {
            message,
            history,
            systemPrompt,
            workspaceId,
            adminSupabase: db,
            integrationManifest,
            tools: SKYLER_TOOLS,
            toolExecutor: skylerToolExecutor,
          },
          (event: SSEEvent) => {
            send(event);
          }
        );

        const { fullResponse, allResults, webResults } = agentResult;

        // ── Step 4: Sources ─────────────────────────────────────────────
        const sources = deduplicateSources(allResults);
        const webSources: SourceInfo[] = webResults.map((r) => ({
          source_type: "web",
          title: r.title,
          channel: r.url,
        }));
        send({ type: "sources", sources: [...sources, ...webSources] });

        // ── Step 5: Save assistant message ──────────────────────────────
        const savedContent = fullResponse;

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

        afterData = {
          savedContent,
          history,
          fullResponse: agentResult.fullResponse,
        };

        controller.close();
      } catch (err) {
        console.error("[skyler-chat] Pipeline error:", err);
        try {
          send({ type: "error", error: sanitizeErrorForUser(err) });
        } catch { /* controller may already be closed */ }
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  // ── Background tasks ──────────────────────────────────────────────────
  after(async () => {
    // Auto-title new conversations
    if (isNewConversation && conversationId && afterData) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const titleRes = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 50,
          messages: [
            {
              role: "user",
              content: `Generate a short, specific title (max 6 words) for a sales conversation. Use deal names, company names, or sales topics from the content. Return only the title.\n\nUser question: "${message}"\n\nSkyler's response (first 300 chars): "${afterData.savedContent.slice(0, 300)}"`,
            },
          ],
        });
        const raw =
          titleRes.content[0]?.type === "text"
            ? titleRes.content[0].text.trim().replace(/^["']|["']$/g, "")
            : null;
        if (raw && conversationId) {
          await db.from("conversations").update({ title: raw }).eq("id", conversationId);
          console.log(`[skyler-chat] Auto-titled: "${raw}"`);
        }
      } catch (titleErr) {
        console.error("[skyler-chat] Auto-title failed:", titleErr);
      }
    }

    // Memory extraction (shared workspace_memories table)
    if (afterData) {
      try {
        const fullConversation = [
          ...afterData.history,
          { role: "user" as const, content: message },
          { role: "assistant" as const, content: afterData.savedContent },
        ];

        const existingMemories = await getAllMemoryContents(db, workspaceId);
        const extracted = await extractMemories(fullConversation, existingMemories);

        for (const memory of extracted) {
          const result = await saveMemory(
            db,
            workspaceId,
            memory,
            user.id,
            conversationId ?? undefined
          );
          console.log(`[skyler-memory] ${result.action}: ${memory.content.slice(0, 80)}`);
        }

        console.log(`[skyler-memory] Extraction complete: ${extracted.length} memories found`);

        // Embed conversation for cross-chat search
        try {
          await embedChatHistory(db, workspaceId, conversationId!, fullConversation, user.id);
        } catch (embedError) {
          console.error("[skyler-chat-embedder] Failed:", embedError);
        }
      } catch (error) {
        console.error("[skyler-memory] Extraction failed:", error);
      }
    }
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

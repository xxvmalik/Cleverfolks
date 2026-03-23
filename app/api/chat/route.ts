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
  buildAgentSystemPrompt,
  type WorkspaceRow,
  type OnboardingRow,
  type KnowledgeProfileRow,
} from "@/lib/cleverbrain/system-prompt";
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

// ── Source helpers ─────────────────────────────────────────────────────────────

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
  if (sourceType === "cleverbrain_chat") {
    return "CleverBrain conversation";
  }
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
  if (sourceType === "hubspot_contact") {
    return (meta.name as string | undefined) ?? "";
  }
  if (sourceType === "hubspot_company") {
    return (meta.name as string | undefined) ?? "";
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

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { chatRateLimit, checkRateLimit, rateLimitResponse } = await import("@/lib/rate-limit");
  const rl = await checkRateLimit(chatRateLimit, `chat:${user.id}`);
  if (rl.limited) return rateLimitResponse(rl.resetMs);

  // ── Parse and validate body ──────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { cleverBrainChatSchema } = await import("@/lib/validations/chat");
  const parsed = cleverBrainChatSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request", details: parsed.error.issues.map((i) => i.message) }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { message, workspaceId, conversationId: inputConversationId } = parsed.data;

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
  const encoder = new TextEncoder();

  // ── Fetch workspace/onboarding/profile/integrations in parallel ───────────
  const [
    { data: workspaceRow },
    { data: onboardingRow },
    { data: profileRow },
    { data: integrationsRows },
  ] = await Promise.all([
    db
      .from("workspaces")
      .select("name, settings")
      .eq("id", workspaceId)
      .single(),
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

  // Retrieve relevant memories for this query
  const memories = await retrieveMemories(
    db,
    workspaceId,
    message,
    user.id,
    15
  );
  if (memories.length > 0) {
    console.log(`[chat] Retrieved ${memories.length} memories for query`);
  }

  const systemPrompt = buildAgentSystemPrompt(
    workspaceRow as WorkspaceRow | null,
    onboardingRow as OnboardingRow | null,
    profileRow as KnowledgeProfileRow | null,
    integrationManifest,
    memories
  );

  let conversationId: string | null = inputConversationId ?? null;
  let isNewConversation = false;

  // Hoisted state for after() callbacks (populated inside stream, read after response)
  let afterData: {
    savedContent: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    fullResponse: string;
  } | null = null;

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
              p_agent_type: "cleverbrain",
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
        const FULL_HISTORY_COUNT = 15;
        let history: Array<{ role: "user" | "assistant"; content: string }> =
          [];
        try {
          const { data: msgs } = await db.rpc("get_conversation_messages", {
            p_conversation_id: conversationId,
          });
          const allMessages = ((msgs ?? []) as HistoryMessage[])
            .slice(0, -1) // exclude the just-saved user message
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));

          if (allMessages.length <= FULL_HISTORY_COUNT) {
            // Short conversation — send everything
            history = allMessages;
          } else {
            // Long conversation — summarize older messages, keep recent in full
            const olderMessages = allMessages.slice(0, -FULL_HISTORY_COUNT);
            const recentMessages = allMessages.slice(-FULL_HISTORY_COUNT);

            const summary = await summarizeConversation(olderMessages);

            if (summary) {
              history = [
                {
                  role: "user" as const,
                  content: `[CONVERSATION CONTEXT: Earlier in this conversation, we discussed: ${summary}]`,
                },
                {
                  role: "assistant" as const,
                  content: "Understood, I have that context.",
                },
                ...recentMessages,
              ];
            } else {
              history = recentMessages;
            }
          }
        } catch (histErr) {
          console.error("[chat] Failed to load history:", histErr);
        }

        // ── Step 3: Run agent loop ───────────────────────────────────────────
        const agentResult = await runAgentLoop(
          {
            message,
            history,
            systemPrompt,
            workspaceId,
            adminSupabase: db,
            integrationManifest,
          },
          (event: SSEEvent) => {
            send(event);
          }
        );

        const { fullResponse, allResults, webResults } = agentResult;

        // ── Step 4: Sources (deduplicated by document_id) ────────────────────
        const sources = deduplicateSources(allResults);

        // Add web result sources
        const webSources: SourceInfo[] = webResults.map((r) => ({
          source_type: "web",
          title: r.title,
          channel: r.url,
        }));

        send({ type: "sources", sources: [...sources, ...webSources] });

        // ── Step 5: Check for role update tag ────────────────────────────────
        const roleMatch = fullResponse.match(ROLE_UPDATE_RE);
        const savedContent = roleMatch
          ? stripRoleUpdateTag(fullResponse)
          : fullResponse;

        if (roleMatch) {
          void applyRoleUpdate(roleMatch, workspaceId, db);
        }

        // ── Step 6: Save assistant message ───────────────────────────────────
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

        // Save data for after() callbacks before closing the stream
        afterData = {
          savedContent,
          history,
          fullResponse: agentResult.fullResponse,
        };

        controller.close();
      } catch (err) {
        console.error("[chat] Pipeline error:", err);
        try {
          send({
            type: "error",
            error: sanitizeErrorForUser(err),
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

  // ── Background tasks (run after response is sent, kept alive on Vercel) ───
  after(async () => {
    // Auto-title new conversations
    if (isNewConversation && conversationId && afterData) {
      try {
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        const titleRes = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 50,
          messages: [
            {
              role: "user",
              content: `Generate a short, specific title (max 6 words) for a conversation based on the user's question and the assistant's response. Use names, IDs, or topics from the actual content — avoid generic titles. Return only the title, nothing else.\n\nUser question: "${message}"\n\nAssistant response (first 300 chars): "${afterData.savedContent.slice(0, 300)}"`,
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
    }

    // Memory extraction
    if (afterData) {
      try {
        const fullConversation = [
          ...afterData.history,
          { role: "user" as const, content: message },
          { role: "assistant" as const, content: afterData.savedContent },
        ];

        const existingMemories = await getAllMemoryContents(db, workspaceId);
        const extracted = await extractMemories(
          fullConversation,
          existingMemories
        );

        for (const memory of extracted) {
          const result = await saveMemory(
            db,
            workspaceId,
            memory,
            user.id,
            conversationId ?? undefined
          );
          console.log(
            `[memory] ${result.action}: ${memory.content.slice(0, 80)}`
          );
        }

        console.log(
          `[memory] Extraction complete: ${extracted.length} memories found`
        );

        // Embed conversation for cross-chat search
        try {
          await embedChatHistory(
            db,
            workspaceId,
            conversationId!,
            fullConversation,
            user.id
          );
        } catch (embedError) {
          console.error("[chat-embedder] Failed:", embedError);
        }
      } catch (error) {
        console.error("[memory] Extraction failed:", error);
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

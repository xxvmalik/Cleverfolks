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
import type { SkylerWorkflowSettings } from "@/app/api/skyler/workflow-settings/route";
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
import * as Sentry from "@sentry/nextjs";
import { classifyDirective } from "@/lib/skyler/directives/classify-directive";
import { saveDirective, getActiveDirectives } from "@/lib/skyler/directives/directive-store";
import { extractFacts } from "@/lib/skyler/memory/fact-extractor";
import { setMemory, getMemories, type AgentMemory } from "@/lib/skyler/memory/agent-memory-store";
import {
  resolveActiveEntity,
  updateFocusStack,
  updateConversationEntity,
  loadConversationEntityState,
  type ResolvedEntity,
  type EntityFocusEntry,
} from "@/lib/skyler/entity/entity-resolver";
import { filterHistoryByEntity, loadEntityScopedHistory } from "@/lib/skyler/entity/history-filter";
import { buildActiveEntityBlock, validateEntityGrounding } from "@/lib/skyler/entity/entity-validator";

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

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { chatRateLimit, checkRateLimit, rateLimitResponse } = await import("@/lib/rate-limit");
  const rl = await checkRateLimit(chatRateLimit, `skyler:${user.id}`);
  if (rl.limited) return rateLimitResponse(rl.resetMs);

  // ── Parse and validate body ──────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { skylerChatSchema } = await import("@/lib/validations/chat");
  const parsed = skylerChatSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request", details: parsed.error.issues.map((i) => i.message) }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { message, workspaceId, conversationId: inputConversationId, pipelineContext, pageContext } = parsed.data;

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
    agentMemoriesResult,
    { data: agentConfigRow },
  ] = await Promise.all([
    db.from("workspaces").select("name, settings").eq("id", workspaceId).single(),
    db.from("onboarding_state").select("org_data, skyler_data").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("knowledge_profiles").select("profile, status").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("integrations").select("provider").eq("workspace_id", workspaceId).eq("status", "connected"),
    getMemories(db, workspaceId),
    db.from("agent_configurations").select("config").eq("workspace_id", workspaceId).eq("agent_type", "skyler").maybeSingle(),
  ]);

  const agentMemories: AgentMemory[] = agentMemoriesResult;
  if (agentMemories.length > 0) {
    console.log(`[skyler-chat] Loaded ${agentMemories.length} agent memories for workspace`);
  }

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

  // Extract Workflow Settings — agent_configurations takes priority over legacy skyler_workflow
  const rawWorkflow = wsSettings.skyler_workflow as SkylerWorkflowSettings | undefined;
  const agentCfg = (agentConfigRow?.config ?? {}) as Partial<SkylerWorkflowSettings>;
  const workflowSettings: SkylerWorkflowSettings | null = rawWorkflow || Object.keys(agentCfg).length > 0
    ? { ...(rawWorkflow ?? {} as SkylerWorkflowSettings), ...agentCfg }
    : null;
  if (workflowSettings) {
    console.log(`[skyler-chat] Workflow settings loaded — autonomy: ${workflowSettings.autonomyLevel}, goal: ${workflowSettings.primaryGoal ?? "not set"}`);
  } else {
    console.log(`[skyler-chat] No workflow settings configured — using defaults`);
  }

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

  // ── Stage 12: Entity Resolution (BEFORE any LLM call) ────────────────
  // Load conversation entity state if we have a conversation
  let conversationEntityState: Awaited<ReturnType<typeof loadConversationEntityState>> = null;
  if (inputConversationId) {
    conversationEntityState = await loadConversationEntityState(db, inputConversationId);
  }

  // Resolve the active entity deterministically
  const previousEntityId = conversationEntityState?.activeEntityId ?? null;
  const previousEntityName = conversationEntityState?.activeEntityName ?? null;
  const resolvedEntity: ResolvedEntity | null = await resolveActiveEntity(
    db,
    workspaceId,
    message,
    pipelineContext ?? null,
    conversationEntityState
  );

  const entitySwitched = resolvedEntity != null && previousEntityId != null && resolvedEntity.entityId !== previousEntityId;
  if (entitySwitched) {
    console.log(`[skyler-chat] Entity switched: ${previousEntityName} → ${resolvedEntity!.entityName}`);
  }

  // If a lead is tagged/resolved, load lead-specific memories
  let effectiveAgentMemories = agentMemories;
  const activeEntityId = resolvedEntity?.entityId ?? pipelineContext?.pipeline_id as string | undefined;
  if (activeEntityId) {
    try {
      effectiveAgentMemories = await getMemories(db, workspaceId, activeEntityId);
    } catch {
      // Fall back to workspace-only memories
    }
  }

  let systemPrompt = buildSkylerSystemPrompt(
    workspaceRow as WorkspaceRow | null,
    onboardingRow as OnboardingRow | null,
    profileRow as KnowledgeProfileRow | null,
    integrationManifest,
    memories,
    autonomyLevel,
    pendingActions,
    workflowSettings,
    effectiveAgentMemories
  );

  // ── Inject page context (Part B of Stage 14) ─────────────────────────────
  if (pageContext) {
    const pc = pageContext;
    const entities = (pc.visibleEntities ?? [])
      .slice(0, 10)
      .map((e: { type: string; name: string }) => `${e.type}: ${e.name}`)
      .join(", ");
    const actions = (pc.recentActions ?? []).slice(0, 5).join(", ");

    systemPrompt += `\n\n<current_context>
User is chatting from the ${pc.pageType ?? "unknown"} page.
Route: ${pc.route ?? "/unknown"}
Current time: ${pc.timestamp ?? new Date().toISOString()}
${entities ? `Visible on screen: ${entities}` : "No specific entities visible."}
${actions ? `Recent actions: ${actions}` : ""}
</current_context>`;
  }

  // Cache boundary: everything up to here is semi-static (identity + settings + tools).
  // Dynamic content (clarification, entity block) is appended after this point.
  const systemPromptCacheBreakpoint = systemPrompt.length;

  // ── Stage 12: Build active entity context (appended LAST to prompt) ──
  // Entity data is loaded fresh and placed at the END of the system prompt
  // for highest attention. Replaces the old inline HIGHLIGHTED LEAD CONTEXT.
  let activeEntityBlock = "";

  if (resolvedEntity) {
    const entityId = resolvedEntity.entityId;

    // Load fresh entity data
    const [{ data: entityPipeline }, entityDirectives, { data: entityMeetings }] = await Promise.all([
      db
        .from("skyler_sales_pipeline")
        .select("contact_email, contact_name, company_name, stage, emails_sent, emails_replied, emails_opened, conversation_thread, deal_value, meeting_outcome, meeting_transcript, updated_at")
        .eq("id", entityId)
        .single(),
      getActiveDirectives(db, entityId),
      db
        .from("meeting_transcripts")
        .select("summary")
        .eq("lead_id", entityId)
        .eq("processing_status", "complete")
        .order("meeting_date", { ascending: false })
        .limit(1),
    ]);

    if (entityPipeline) {
      const thread = (entityPipeline.conversation_thread ?? []) as Array<{
        role: string; content: string; subject?: string; timestamp: string;
      }>;

      const meetingSummary = entityMeetings?.[0]?.summary ?? undefined;

      activeEntityBlock = buildActiveEntityBlock(
        {
          entityId,
          entityName: entityPipeline.contact_name ?? resolvedEntity.entityName,
          companyName: entityPipeline.company_name ?? resolvedEntity.companyName,
          contactEmail: entityPipeline.contact_email ?? resolvedEntity.contactEmail,
          stage: entityPipeline.stage,
          emailsSent: entityPipeline.emails_sent,
          emailsReplied: entityPipeline.emails_replied,
          dealValue: entityPipeline.deal_value,
          lastActivity: entityPipeline.updated_at,
        },
        thread,
        entityDirectives.map((d) => ({ directive_text: d.directive_text, created_at: d.created_at })),
        meetingSummary
      );
    } else {
      // Pipeline record not found by ID (e.g. tagged from lead_scores).
      // Build a minimal entity block so Claude still knows who the user means.
      console.warn(`[skyler-chat] No pipeline record for entity ${entityId} — using tag info only`);
      activeEntityBlock = buildActiveEntityBlock(
        {
          entityId,
          entityName: resolvedEntity.entityName,
          companyName: resolvedEntity.companyName,
          contactEmail: resolvedEntity.contactEmail,
          stage: pipelineContext?.stage as string | undefined,
          emailsSent: 0,
          emailsReplied: 0,
          dealValue: undefined,
          lastActivity: undefined,
        },
        [],
        [],
        undefined
      );
    }
  }

  // Handle email-level highlight — append to entity block
  if (pipelineContext?.referenced_email && resolvedEntity) {
    const email = pipelineContext.referenced_email;
    const emailStatus = email.status ?? (email.role === "skyler" ? "sent" : "received");
    const isPending = emailStatus === "pending";

    activeEntityBlock += `\n\n<highlighted_email status="${emailStatus}">
Subject: ${email.subject ?? "(no subject)"}
Content:
${email.content}
</highlighted_email>

${isPending ? `This email is a pending draft (not sent yet). If the user gives feedback, offer to redraft it.` : `This email was already sent. If the user gives feedback on the email content, store it as a workspace memory for future emails AND use draft_correction_email to create a corrected follow-up if they want one (pipeline_id: "${resolvedEntity.entityId}", to: "${resolvedEntity.contactEmail}").`}`;
  }

  // ── Handle clarification replies (low-confidence research pause) ─────────
  const isClarification = pipelineContext?.referenced_email?.status === "clarification_needed";
  if (isClarification && pipelineContext?.pipeline_id) {
    const clarificationPipelineId = pipelineContext.pipeline_id as string;

    systemPrompt += `\n\n## CLARIFICATION CONTEXT
The user is replying to a Skyler Note asking for more context about a lead.
Pipeline: ${pipelineContext.contact_name} at ${pipelineContext.company_name} (ID: ${clarificationPipelineId})

The user's message contains context about what this business does.
1. Acknowledge the information warmly and briefly
2. Confirm you'll use it to draft a better email
3. DO NOT draft the email in this chat — the Sales Closer workflow will handle it automatically

IMPORTANT: After you respond, the system will automatically resume the Sales Closer workflow with this new context.
`;

    // Fire clarification event in after() callback
    after(async () => {
      try {
        const { inngest } = await import("@/lib/inngest/client");
        await inngest.send({
          name: "skyler/pipeline.clarification.received",
          data: {
            pipelineId: clarificationPipelineId,
            workspaceId,
            userContext: message,
          },
        });
        console.log(`[skyler-chat] Fired clarification event for pipeline ${clarificationPipelineId}`);
      } catch (err) {
        console.error("[skyler-chat] Clarification event failed:", err);
      }
    });
  }

  // ── Directive detection + request response (for pipeline-tagged messages) ──
  if (pipelineContext?.pipeline_id && !isClarification) {
    const taggedPipelineId = pipelineContext.pipeline_id as string;

    after(async () => {
      try {
        // 1. Check if this is a response to a pending info request
        const { data: pendingReqs } = await db
          .from("skyler_requests")
          .select("id, request_description")
          .eq("pipeline_id", taggedPipelineId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);

        if (pendingReqs && pendingReqs.length > 0) {
          const req = pendingReqs[0];
          console.log(`[skyler-chat] Fulfilling info request ${req.id}: "${req.request_description}"`);

          // Mark request as fulfilled
          await db
            .from("skyler_requests")
            .update({
              status: "fulfilled",
              response_content: message,
              fulfilled_at: new Date().toISOString(),
            })
            .eq("id", req.id);

          // Extract facts from the user's response and store permanently
          try {
            const facts = await extractFacts(message, req.request_description);
            if (facts.length > 0) {
              for (const fact of facts) {
                await setMemory(
                  db,
                  workspaceId,
                  fact.fact_key,
                  fact.fact_value,
                  fact.category,
                  "user_provided",
                  fact.is_workspace_level ? undefined : taggedPipelineId
                );
                console.log(`[skyler-chat] Stored fact: ${fact.fact_key} = ${fact.fact_value} (${fact.category}, ${fact.is_workspace_level ? "workspace" : "lead"})`);
              }
              console.log(`[skyler-chat] Extracted and stored ${facts.length} facts from user response`);
            }
          } catch (factErr) {
            console.error("[skyler-chat] Fact extraction failed:", factErr);
          }

          // Clear the skyler_note banner on the lead card
          await db
            .from("skyler_sales_pipeline")
            .update({
              skyler_note: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", taggedPipelineId);

          // Fire event to resume the paused Inngest function
          const { inngest } = await import("@/lib/inngest/client");
          await inngest.send({
            name: "skyler/reasoning.user-response",
            data: {
              pipelineId: taggedPipelineId,
              workspaceId,
              eventType: "user.response" as const,
              eventData: {
                response: message,
                requestId: req.id,
                originalRequest: req.request_description,
              },
            },
          });
          console.log(`[skyler-chat] Fired user-response event for pipeline ${taggedPipelineId}`);
        }

        // 2. Check if this is a directive (persistent instruction about the lead)
        const classification = await classifyDirective(message);
        if (classification.is_directive && classification.directive_text) {
          const result = await saveDirective(
            db,
            workspaceId,
            taggedPipelineId,
            classification.directive_text
          );
          if (result) {
            console.log(`[skyler-chat] Saved directive for pipeline ${taggedPipelineId}`);

            // Also fire event so reasoning engine re-evaluates with the directive
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({
              name: "skyler/reasoning.user-directive",
              data: {
                pipelineId: taggedPipelineId,
                workspaceId,
                eventType: "user.directive" as const,
                eventData: {
                  directive: classification.directive_text,
                  directiveId: result.id,
                },
              },
            });
          }
        }

        // 3. Check if this is a behaviour correction (Stage 11, Part B)
        if (!classification.is_directive) {
          try {
            const { classifyUserMessage } = await import("@/lib/skyler/learning/correction-classifier");
            const correctionResult = await classifyUserMessage(message);

            if (correctionResult && correctionResult.type === "behaviour_correction") {
              const { inngest } = await import("@/lib/inngest/client");
              await inngest.send({
                name: "skyler/correction.received",
                data: {
                  correctionType: correctionResult.type,
                  correctionText: correctionResult.correction_text,
                  isVague: correctionResult.is_vague,
                  pipelineId: taggedPipelineId,
                  workspaceId,
                },
              });
              console.log(`[skyler-chat] Behaviour correction detected (vague: ${correctionResult.is_vague})`);
            }
          } catch (corrErr) {
            console.error("[skyler-chat] Correction classification failed:", corrErr);
          }
        }
      } catch (err) {
        console.error("[skyler-chat] Directive/request processing failed:", err);
      }
    });
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
        // Emit initial activity immediately so the frontend shows thinking state
        send({ type: "activity", action: "Thinking..." }); // filtered by HIDDEN_ACTIVITIES on frontend

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

        // Save user message — embed pipeline context so it persists in history
        // for follow-up messages in the same conversation
        let savedUserContent = message;
        if (pipelineContext?.pipeline_id) {
          const ctx = pipelineContext;
          const emailSubject = ctx.referenced_email?.subject ?? "no subject";
          savedUserContent = `[Pipeline context: ${ctx.contact_name} at ${ctx.company_name} (pipeline_id: ${ctx.pipeline_id}, email: ${emailSubject})]\n\n${message}`;
        }

        await db.rpc("create_chat_message", {
          p_conversation_id: conversationId,
          p_role: "user",
          p_content: savedUserContent,
          p_sources: null,
          p_active_entity_id: resolvedEntity?.entityId ?? null,
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

        // ── Step 2b: Entity-scoped history filtering (Stage 12, Part C) ──
        if (resolvedEntity && entitySwitched && conversationId) {
          // Load messages with entity IDs for proper filtering
          const entityHistory = await loadEntityScopedHistory(db, conversationId, 30);
          // Remove the last message (current user message, not yet complete)
          const pastMessages = entityHistory.slice(0, -1);

          if (pastMessages.length > 0) {
            history = filterHistoryByEntity(
              pastMessages,
              resolvedEntity.entityId,
              resolvedEntity.entityName,
              previousEntityId,
              previousEntityName
            );
            console.log(`[skyler-chat] Filtered history: ${pastMessages.length} → ${history.length} messages (entity switch)`);
          }
        }

        // ── Step 2c: Append active entity block LAST (highest attention) ──
        if (activeEntityBlock) {
          systemPrompt += `\n\n${activeEntityBlock}`;
        }

        // ── Step 2d: Update conversation entity state ──────────────────
        if (resolvedEntity && conversationId) {
          const currentStack = conversationEntityState?.entityFocusStack ?? [];
          const turnNumber = history.length + 1;
          const newStack = updateFocusStack(currentStack, resolvedEntity, turnNumber);
          // Fire-and-forget — don't block the response
          updateConversationEntity(db, conversationId, resolvedEntity, newStack).catch((err) =>
            console.error("[skyler-chat] Failed to update conversation entity:", err)
          );
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
            systemPromptCacheBreakpoint,
            finalMaxTokens: 1024,
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
          p_active_entity_id: resolvedEntity?.entityId ?? null,
        });

        // ── Stage 12 Part D: Post-generation entity validation ──────
        let entityWarning: string | undefined;
        if (resolvedEntity && conversationEntityState?.entityFocusStack?.length) {
          const otherEntities = conversationEntityState.entityFocusStack
            .filter((e) => e.entity_id !== resolvedEntity.entityId)
            .map((e) => ({ entityName: e.entity_name, companyName: e.company_name }));

          if (otherEntities.length > 0) {
            const validation = validateEntityGrounding(fullResponse, resolvedEntity, otherEntities);
            if (!validation.isClean) {
              entityWarning = validation.warning;
              console.warn(`[skyler-chat] Entity contamination: ${entityWarning}`);
            }
          }
        }

        send({
          type: "metadata",
          conversationId,
          messageId: assistantMsgId ?? null,
          entityWarning,
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
        Sentry.captureException(err, { tags: { route: "skyler-chat" } });
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
          console.log(`[skyler-memory] ${result.action}: ${memory.type} memory (${memory.scope})`);
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

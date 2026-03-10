/**
 * Sales Closer Inngest durable functions.
 * Manages the full outreach lifecycle: research -> draft -> approve -> send -> follow-up.
 * APPROVAL MODE ONLY: all emails are drafted for user approval before sending.
 */

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { researchCompany } from "@/lib/skyler/company-research";
import { learnSalesVoice, getSalesVoice } from "@/lib/skyler/voice-learner";
import { draftEmail } from "@/lib/skyler/email-drafter";
import type { LeadContext } from "@/lib/skyler/email-drafter";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { buildSalesPlaybook } from "@/lib/skyler/sales-playbook";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

// Reply intent classification type
type ReplyIntent = "positive_interest" | "objection" | "meeting_accept" | "opt_out";
type ReplyClassification = { intent: ReplyIntent; reasoning: string };

// ── Sales Closer Workflow ─────────────────────────────────────────────────────
// Triggered when a lead scores hot (70+). Manages the full outreach lifecycle.

export const salesCloserWorkflow = inngest.createFunction(
  {
    id: "sales-closer-workflow",
    retries: 1,
  },
  { event: "skyler/lead.qualified.hot" },
  async ({ event, step }) => {
    const {
      contactId,
      contactEmail,
      contactName,
      companyName,
      companyId,
      workspaceId,
      leadScoreId,
      leadScore,
      pipelineId: existingPipelineId,
    } = event.data as {
      contactId: string;
      contactEmail: string;
      contactName: string;
      companyName: string;
      companyId?: string;
      workspaceId: string;
      leadScoreId?: string;
      leadScore?: number;
      pipelineId?: string;
    };

    if (!contactEmail) {
      console.warn("[sales-closer] No email for contact, cannot proceed");
      return { status: "skipped", reason: "no_email" };
    }

    // Step 1: Get or create pipeline record (returns full record)
    const pipeline = await step.run("create-pipeline-record", async () => {
      const db = createAdminSupabaseClient();
      console.log("[Sales Closer] Step 1: Getting or creating pipeline record...");

      // If a pipeline record was already created by the entry point, fetch it
      if (existingPipelineId) {
        const { data: existing } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", existingPipelineId)
          .single();
        if (existing) {
          console.log(`[Sales Closer] Using existing pipeline record ${existing.id}`);
          return existing;
        }
      }

      // Check for existing pipeline record by email
      const { data: byEmail } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("contact_email", contactEmail)
        .single();

      if (byEmail) {
        console.log(`[Sales Closer] Contact ${contactEmail} already in pipeline (${byEmail.stage})`);
        return byEmail;
      }

      // Create new record
      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .insert({
          workspace_id: workspaceId,
          contact_id: contactId,
          contact_name: contactName,
          contact_email: contactEmail,
          company_name: companyName,
          company_id: companyId ?? null,
          stage: "initial_outreach",
          lead_score: leadScore ?? null,
          lead_score_id: leadScoreId ?? null,
        })
        .select("*")
        .single();

      if (error) throw new Error(`Failed to create pipeline record: ${error.message}`);
      console.log(`[Sales Closer] Created pipeline record ${data!.id} for ${contactEmail}`);
      return data!;
    });

    // Step 2: Fetch workspace business context (needed for research + drafting)
    const memories = await step.run("fetch-business-context", async () => {
      console.log("[Sales Closer] Step 2: Fetching business context...");
      const db = createAdminSupabaseClient();
      // Active memories = superseded_by IS NULL (no status column exists)
      const { data: memData, error: memErr } = await db
        .from("workspace_memories")
        .select("content")
        .eq("workspace_id", workspaceId)
        .is("superseded_by", null)
        .order("times_reinforced", { ascending: false })
        .limit(20);
      if (memErr) console.error("[Sales Closer] Memory fetch error:", memErr.message);
      const rawMemories = (memData ?? []).map((m) => m.content as string);
      const result = filterDealMemories(rawMemories);
      console.log(`[Sales Closer] Loaded ${rawMemories.length} memories, ${result.length} after filtering deal data`);
      if (result.length > 0) {
        console.log(`[Sales Closer] First memory: ${result[0].substring(0, 120)}`);
      }
      return result;
    });

    // Step 3: Load sender identity (workspace owner name + company name)
    const senderIdentity = await step.run("load-sender-identity", async () => {
      console.log("[Sales Closer] Step 3: Loading sender identity...");
      const db = createAdminSupabaseClient();

      // Get workspace owner's name from profiles via membership
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: memberData } = await db
        .from("workspace_memberships")
        .select("profiles(full_name, email)")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .limit(1)
        .single();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profile = (memberData as any)?.profiles;
      const ownerName: string | null = Array.isArray(profile)
        ? profile[0]?.full_name
        : profile?.full_name ?? null;

      // Get company name from workspace settings
      const { data: ws } = await db
        .from("workspaces")
        .select("settings")
        .eq("id", workspaceId)
        .single();
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      const companyFromSettings = (settings.company_name as string) ?? null;

      console.log(`[Sales Closer] Sender: ${ownerName ?? "unknown"}, Company: ${companyFromSettings ?? "unknown"}`);
      return { senderName: ownerName, senderCompany: companyFromSettings };
    });

    // Step 4: Load knowledge profile (authoritative source for what the business does)
    const knowledgeProfile = await step.run("load-knowledge-profile", async () => {
      console.log("[Sales Closer] Step 4: Loading knowledge profile...");
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("knowledge_profiles")
        .select("profile, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (!data?.profile || !["ready", "pending_review"].includes(data.status ?? "")) {
        console.log(`[Sales Closer] No usable knowledge profile (status: ${data?.status ?? "none"})`);
        return null;
      }

      const profile = data.profile as Record<string, unknown>;
      console.log(`[Sales Closer] Knowledge profile loaded — ${(profile.key_topics as string[] ?? []).length} topics, ${(profile.business_patterns as string[] ?? []).length} patterns`);
      return profile;
    });

    // Step 5: Build structured sales playbook from knowledge profile + memories
    const playbook = await step.run("build-sales-playbook", async () => {
      console.log("[Sales Closer] Step 5: Building sales playbook...");
      const db = createAdminSupabaseClient();
      return await buildSalesPlaybook(db, workspaceId, memories, knowledgeProfile);
    });

    // Step 6: Research the company (with playbook for alignment)
    const research = await step.run("research-company", async () => {
      console.log("[Sales Closer] Step 6: Researching company...");
      const db = createAdminSupabaseClient();
      return await researchCompany({
        companyName: pipeline.company_name || companyName,
        contactName: pipeline.contact_name || contactName,
        contactEmail: pipeline.contact_email || contactEmail,
        workspaceId: pipeline.workspace_id || workspaceId,
        pipelineId: pipeline.id,
        db,
        businessContext: memories.join("\n"),
        salesPlaybook: playbook,
      });
    });

    // Step 7: Learn sales voice (if not already learned)
    const voice = await step.run("learn-sales-voice", async () => {
      console.log("[Sales Closer] Step 7: Learning sales voice...");
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    // Step 8: Load lead context from HubSpot (deal data, notes)
    const leadContext = await step.run("load-lead-context", async () => {
      console.log("[Sales Closer] Step 8: Loading lead context...");
      const db = createAdminSupabaseClient();
      const ctx: LeadContext = { source: "scored" };

      // Look for HubSpot deal data in document_chunks
      const email = pipeline.contact_email || contactEmail;
      const name = pipeline.contact_name || contactName;
      const company = pipeline.company_name || companyName;

      // Search for deal records mentioning this contact
      const { data: dealChunks } = await db
        .from("document_chunks")
        .select("chunk_text, metadata")
        .eq("workspace_id", workspaceId)
        .eq("metadata->>source_type", "hubspot_deal")
        .or(`chunk_text.ilike.%${email}%,chunk_text.ilike.%${name}%,chunk_text.ilike.%${company}%`)
        .order("created_at", { ascending: false })
        .limit(5);

      if (dealChunks && dealChunks.length > 0) {
        const firstDeal = dealChunks[0];
        const meta = (firstDeal.metadata ?? {}) as Record<string, string>;
        ctx.hubspot_deal_stage = meta.deal_stage ?? meta.dealstage ?? undefined;
        ctx.hubspot_deal_amount = meta.amount ?? undefined;
        ctx.hubspot_deal_name = meta.name ?? meta.dealname ?? undefined;
        console.log(`[Sales Closer] Found ${dealChunks.length} HubSpot deal chunks for ${email}`);
      }

      // Search for notes mentioning this contact
      const { data: noteChunks } = await db
        .from("document_chunks")
        .select("chunk_text")
        .eq("workspace_id", workspaceId)
        .in("metadata->>source_type", ["hubspot_note", "note"])
        .or(`chunk_text.ilike.%${email}%,chunk_text.ilike.%${name}%`)
        .order("created_at", { ascending: false })
        .limit(3);

      if (noteChunks && noteChunks.length > 0) {
        ctx.hubspot_notes = noteChunks.map((n) => (n.chunk_text as string).slice(0, 300));
        console.log(`[Sales Closer] Found ${noteChunks.length} notes for ${email}`);
      }

      return ctx;
    });

    // Derive sender company: prefer knowledge profile, fall back to workspace settings
    const senderCompany = senderIdentity.senderCompany
      ?? (knowledgeProfile?.business_summary ? (knowledgeProfile.business_summary as string).split(/[.,]/)[0] : undefined)
      ?? (playbook?.company_name || undefined);

    // Step 9: Draft initial outreach email (using playbook + lead context)
    const draft = await step.run("draft-initial-email", async () => {
      console.log("[Sales Closer] Step 9: Drafting initial email...");

      return await draftEmail({
        workspaceId,
        pipelineRecord: {
          id: pipeline.id,
          contact_name: pipeline.contact_name || contactName,
          contact_email: pipeline.contact_email || contactEmail,
          company_name: pipeline.company_name || companyName,
          stage: "initial_outreach",
          cadence_step: 0,
          conversation_thread: [],
        },
        cadenceStep: 1,
        companyResearch: research,
        salesVoice: voice,
        conversationThread: [],
        workspaceMemories: memories,
        salesPlaybook: playbook,
        leadContext,
        knowledgeProfile,
        senderName: senderIdentity.senderName ?? undefined,
        senderCompany: senderCompany ?? undefined,
      });
    });

    // Step 10: Store draft for approval
    const action = await step.run("store-draft-for-approval", async () => {
      console.log("[Sales Closer] Step 7: Storing draft for approval...");
      const db = createAdminSupabaseClient();
      return await draftOutreachEmail(db, {
        workspaceId,
        pipelineId: pipeline.id,
        to: pipeline.contact_email || contactEmail,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        textBody: draft.textBody,
      });
    });

    console.log("[Sales Closer] Initial draft complete. Waiting for approval...");
    return { status: "draft_pending", pipeline_id: pipeline.id, action_id: action.actionId };
  }
);

// ── Handle Pipeline Reply ────────────────────────────────────────────────────
// Triggered when an incoming email matches an active pipeline record.
// Classifies the reply intent, then drafts a contextual response for approval.

export const handlePipelineReply = inngest.createFunction(
  {
    id: "handle-pipeline-reply",
    retries: 1,
  },
  { event: "skyler/pipeline.reply.received" },
  async ({ event, step }) => {
    const { pipelineId, contactEmail, workspaceId, replyContent } = event.data as {
      pipelineId: string;
      contactEmail: string;
      workspaceId: string;
      replyContent: string;
      stage: string;
    };

    // Step 1: Fetch pipeline record (reply-detector already updated it with the reply)
    const pipeline = await step.run("fetch-pipeline", async () => {
      const db = createAdminSupabaseClient();
      const { data: current } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("id", pipelineId)
        .single();

      if (!current) throw new Error(`Pipeline record ${pipelineId} not found`);

      // Skip if already resolved (opt-out, disqualified, etc.)
      if (current.resolution) {
        console.log(`[Pipeline Reply] Pipeline ${pipelineId} already resolved (${current.resolution}) — skipping`);
        return null;
      }

      return current;
    });

    if (!pipeline) {
      return { status: "skipped", reason: "resolved" };
    }

    // Step 2: Classify reply intent using Sonnet
    const classification = await step.run("classify-reply-intent", async () => {
      console.log(`[Pipeline Reply] Classifying reply from ${contactEmail}...`);

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Classify this prospect's email reply intent. Reply ONLY with valid JSON, no markdown fences:
{"intent": "positive_interest", "reasoning": "one sentence explaining why"}

Possible intents (pick exactly one):
- positive_interest: prospect is asking questions, wanting more details, showing curiosity, requesting examples or case studies, asking about pricing, asking about results. ANY question about your services is positive interest.
- objection: prospect is pushing back — too expensive, bad timing, not the right fit, already using a competitor, need to think about it. They're engaged but resistant.
- meeting_accept: prospect is agreeing to a call, meeting, demo, or next step. They said yes.
- opt_out: prospect EXPLICITLY says stop emailing, unsubscribe, remove me, don't contact me again, not interested at all. This is ONLY for clear, explicit refusals.

CRITICAL RULES:
- Questions are NEVER opt_out. "What results do you see?" = positive_interest
- "Not right now" or "Bad timing" = objection, NOT opt_out
- "Tell me more" = positive_interest
- Only use opt_out for EXPLICIT stop/remove/unsubscribe requests
- When in doubt between positive_interest and objection, choose positive_interest

PROSPECT'S REPLY:
${replyContent.slice(0, 2000)}`,
        }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      try {
        const result = parseAIJson<ReplyClassification>(text);
        console.log(`[Pipeline Reply] Classification: ${result.intent} — ${result.reasoning}`);
        return result;
      } catch {
        console.warn(`[Pipeline Reply] Failed to parse classification, defaulting to positive_interest`);
        return { intent: "positive_interest" as ReplyIntent, reasoning: "Classification parse failed, defaulting to safe option" };
      }
    });

    // Step 3: Handle opt_out immediately — no need to draft
    if (classification.intent === "opt_out") {
      await step.run("handle-opt-out", async () => {
        const db = createAdminSupabaseClient();
        const now = new Date().toISOString();

        // Append opt-out response to thread
        const thread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;

        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "disqualified",
            resolution_notes: `Opt-out: ${classification.reasoning}`,
            resolved_at: now,
            stage: "disqualified",
            awaiting_reply: false,
            next_followup_at: null,
            conversation_thread: thread,
            updated_at: now,
          })
          .eq("id", pipelineId);

        // Store a brief opt-out acknowledgement for approval
        await draftOutreachEmail(db, {
          workspaceId,
          pipelineId,
          to: contactEmail,
          subject: `Re: ${getLastSubject(thread)}`,
          htmlBody: "<p>Understood, I'll remove you from our outreach. Thanks for your time.</p>",
          textBody: "Understood, I'll remove you from our outreach. Thanks for your time.",
        });

        console.log(`[Pipeline Reply] Opt-out processed for ${contactEmail} — pipeline marked disqualified`);
      });

      return { status: "opt_out_processed", pipeline_id: pipelineId };
    }

    // Step 4: Fetch business context for drafting
    const memories = await step.run("fetch-reply-context", async () => {
      const db = createAdminSupabaseClient();
      const { data: memData } = await db
        .from("workspace_memories")
        .select("content")
        .eq("workspace_id", workspaceId)
        .is("superseded_by", null)
        .order("times_reinforced", { ascending: false })
        .limit(20);
      const raw = (memData ?? []).map((m) => m.content as string);
      return filterDealMemories(raw);
    });

    const replyKnowledgeProfile = await step.run("load-reply-knowledge-profile", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("knowledge_profiles")
        .select("profile, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!data?.profile || !["ready", "pending_review"].includes(data.status ?? "")) return null;
      return data.profile as Record<string, unknown>;
    });

    const playbook = await step.run("build-reply-playbook", async () => {
      const db = createAdminSupabaseClient();
      return await buildSalesPlaybook(db, workspaceId, memories, replyKnowledgeProfile);
    });

    const research = await step.run("research-for-reply", async () => {
      const db = createAdminSupabaseClient();
      return await researchCompany({
        companyName: pipeline.company_name as string,
        contactEmail: pipeline.contact_email as string,
        contactName: pipeline.contact_name as string,
        workspaceId,
        pipelineId,
        db,
        businessContext: memories.join("\n"),
        salesPlaybook: playbook,
      });
    });

    const voice = await step.run("learn-reply-voice", async () => {
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    const replySender = await step.run("load-reply-sender", async () => {
      const db = createAdminSupabaseClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: memberData } = await db
        .from("workspace_memberships")
        .select("profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .limit(1)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prof = (memberData as any)?.profiles;
      const name: string | null = Array.isArray(prof) ? prof[0]?.full_name : prof?.full_name ?? null;

      const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      const company = (settings.company_name as string) ?? playbook?.company_name ?? null;
      return { senderName: name, senderCompany: company };
    });

    // Step 5: Draft intent-aware reply email
    const thread = (pipeline.conversation_thread ?? []) as Array<{
      role: string;
      content: string;
      subject?: string;
      timestamp: string;
    }>;

    const draft = await step.run("draft-reply-email", async () => {
      console.log(`[Pipeline Reply] Drafting ${classification.intent} reply for ${contactEmail}...`);

      return await draftEmail({
        workspaceId,
        pipelineRecord: {
          id: pipelineId,
          contact_name: pipeline.contact_name as string,
          contact_email: pipeline.contact_email as string,
          company_name: pipeline.company_name as string,
          stage: "replied",
          cadence_step: pipeline.cadence_step as number,
          conversation_thread: thread,
        },
        cadenceStep: -1, // Reply mode
        companyResearch: research,
        salesVoice: voice,
        conversationThread: thread,
        workspaceMemories: memories,
        salesPlaybook: playbook,
        knowledgeProfile: replyKnowledgeProfile,
        senderName: replySender.senderName ?? undefined,
        senderCompany: replySender.senderCompany ?? undefined,
        replyIntent: classification.intent,
      });
    });

    // Step 6: Store reply draft for approval
    const action = await step.run("store-reply-draft", async () => {
      const db = createAdminSupabaseClient();
      return await draftOutreachEmail(db, {
        workspaceId,
        pipelineId,
        to: pipeline.contact_email as string,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        textBody: draft.textBody,
      });
    });

    console.log(`[Pipeline Reply] ${classification.intent} reply draft stored for approval: ${action.actionId}`);
    return {
      status: "reply_draft_pending",
      pipeline_id: pipelineId,
      action_id: action.actionId,
      intent: classification.intent,
    };
  }
);

/** Extract the last subject line from a conversation thread. */
function getLastSubject(thread: Array<Record<string, unknown>>): string {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].subject) return thread[i].subject as string;
  }
  return "our conversation";
}

// ── Trigger Sales Closer on Hot Lead ──────────────────────────────────────────
// Listens for contact scored events and triggers the workflow for hot leads.

export const triggerSalesCloserOnHotLead = inngest.createFunction(
  {
    id: "trigger-sales-closer-on-hot-lead",
    retries: 1,
  },
  { event: "skyler/contact.scored" },
  async ({ event, step }) => {
    const { contactId, classification, workspaceId, contactEmail, contactName, companyName, companyId, leadScoreId, score } =
      event.data as {
        contactId: string;
        classification: string;
        workspaceId: string;
        contactEmail?: string;
        contactName?: string;
        companyName?: string;
        companyId?: string;
        leadScoreId?: string;
        score?: number;
      };

    if (classification !== "hot") return { status: "skipped", reason: "not_hot" };
    if (!contactEmail) return { status: "skipped", reason: "no_email" };

    // Check workspace has sales closer enabled
    const isEnabled = await step.run("check-sales-closer-enabled", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("workspaces")
        .select("settings")
        .eq("id", workspaceId)
        .single();
      const settings = (data?.settings ?? {}) as Record<string, unknown>;
      return settings.skyler_sales_closer === true;
    });

    if (!isEnabled) return { status: "skipped", reason: "sales_closer_disabled" };

    // Check if already in pipeline
    const existing = await step.run("check-existing-pipeline", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("contact_email", contactEmail)
        .single();
      return !!data;
    });

    if (existing) return { status: "skipped", reason: "already_in_pipeline" };

    // Trigger the sales closer workflow
    await step.sendEvent("start-sales-closer", {
      name: "skyler/lead.qualified.hot",
      data: {
        contactId,
        contactEmail,
        contactName: contactName ?? "Unknown",
        companyName: companyName ?? "Unknown",
        companyId,
        workspaceId,
        leadScoreId,
        leadScore: score,
      },
    });

    return { status: "triggered" };
  }
);

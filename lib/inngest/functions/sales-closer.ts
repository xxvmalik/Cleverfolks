/**
 * Sales Closer Inngest durable functions.
 * Manages the full outreach lifecycle: research -> draft -> approve -> send -> follow-up.
 * APPROVAL MODE ONLY: all emails are drafted for user approval before sending.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { researchCompany } from "@/lib/skyler/company-research";
import { learnSalesVoice, getSalesVoice } from "@/lib/skyler/voice-learner";
import { draftEmail } from "@/lib/skyler/email-drafter";
import type { LeadContext } from "@/lib/skyler/email-drafter";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { buildSalesPlaybook } from "@/lib/skyler/sales-playbook";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";

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

    // Step 3: Load knowledge profile (authoritative source for what the business does)
    const knowledgeProfile = await step.run("load-knowledge-profile", async () => {
      console.log("[Sales Closer] Step 3: Loading knowledge profile...");
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

    // Step 4: Build structured sales playbook from knowledge profile + memories
    const playbook = await step.run("build-sales-playbook", async () => {
      console.log("[Sales Closer] Step 4: Building sales playbook...");
      const db = createAdminSupabaseClient();
      return await buildSalesPlaybook(db, workspaceId, memories, knowledgeProfile);
    });

    // Step 5: Research the company (with playbook for alignment)
    const research = await step.run("research-company", async () => {
      console.log("[Sales Closer] Step 5: Researching company...");
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

    // Step 6: Learn sales voice (if not already learned)
    const voice = await step.run("learn-sales-voice", async () => {
      console.log("[Sales Closer] Step 6: Learning sales voice...");
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    // Step 7: Load lead context from HubSpot (deal data, notes)
    const leadContext = await step.run("load-lead-context", async () => {
      console.log("[Sales Closer] Step 7: Loading lead context...");
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

    // Step 8: Draft initial outreach email (using playbook + lead context)
    const draft = await step.run("draft-initial-email", async () => {
      console.log("[Sales Closer] Step 8: Drafting initial email...");

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
      });
    });

    // Step 9: Store draft for approval
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
// Drafts a contextual reply for user approval.

export const handlePipelineReply = inngest.createFunction(
  {
    id: "handle-pipeline-reply",
    retries: 1,
  },
  { event: "skyler/pipeline.reply.received" },
  async ({ event, step }) => {
    const { pipelineId, contactEmail, workspaceId, replyContent, stage } = event.data as {
      pipelineId: string;
      contactEmail: string;
      workspaceId: string;
      replyContent: string;
      stage: string;
    };

    // Step 1: Update pipeline record with the reply
    const pipeline = await step.run("update-pipeline-with-reply", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();

      // Fetch current pipeline record
      const { data: current } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("id", pipelineId)
        .single();

      if (!current) throw new Error(`Pipeline record ${pipelineId} not found`);

      // Append reply to conversation thread
      const thread = (current.conversation_thread ?? []) as Array<Record<string, unknown>>;
      thread.push({
        role: "prospect",
        content: replyContent,
        timestamp: now,
        status: "received",
      });

      // Update pipeline: mark as replied, update stage
      await db
        .from("skyler_sales_pipeline")
        .update({
          awaiting_reply: false,
          last_reply_at: now,
          stage: "replied",
          conversation_thread: thread,
          updated_at: now,
        })
        .eq("id", pipelineId);

      console.log(`[Pipeline Reply] Updated pipeline ${pipelineId} with reply from ${contactEmail}`);
      return { ...current, conversation_thread: thread };
    });

    // Step 2: Fetch memories and playbook
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

    // Step 3: Research company (use cache if available)
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

    // Step 4: Learn sales voice
    const voice = await step.run("learn-reply-voice", async () => {
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    // Step 5: Draft reply email (cadenceStep -1 = reply mode)
    const thread = (pipeline.conversation_thread ?? []) as Array<{
      role: string;
      content: string;
      subject?: string;
      timestamp: string;
    }>;

    const draft = await step.run("draft-reply-email", async () => {
      console.log("[Pipeline Reply] Drafting reply email...");
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

    console.log(`[Pipeline Reply] Reply draft stored for approval: ${action.actionId}`);
    return { status: "reply_draft_pending", pipeline_id: pipelineId, action_id: action.actionId };
  }
);

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

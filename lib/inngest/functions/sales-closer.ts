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
import { draftOutreachEmail } from "@/lib/email/email-sender";

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
      const result = (memData ?? []).map((m) => m.content as string);
      console.log(`[Sales Closer] Workspace memories count: ${result.length}`);
      if (result.length > 0) {
        console.log(`[Sales Closer] First memory: ${result[0].substring(0, 120)}`);
      }
      return result;
    });

    // Step 3: Research the company (with our business context for alignment)
    const research = await step.run("research-company", async () => {
      console.log("[Sales Closer] Step 3: Researching company...");
      const db = createAdminSupabaseClient();
      return await researchCompany({
        companyName: pipeline.company_name || companyName,
        contactName: pipeline.contact_name || contactName,
        contactEmail: pipeline.contact_email || contactEmail,
        workspaceId: pipeline.workspace_id || workspaceId,
        pipelineId: pipeline.id,
        db,
        businessContext: memories.join("\n"),
      });
    });

    // Step 4: Learn sales voice (if not already learned)
    const voice = await step.run("learn-sales-voice", async () => {
      console.log("[Sales Closer] Step 4: Learning sales voice...");
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    // Step 5: Draft initial outreach email
    const draft = await step.run("draft-initial-email", async () => {
      console.log("[Sales Closer] Step 5: Drafting initial email...");

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
      });
    });

    // Step 6: Store draft for approval
    const action = await step.run("store-draft-for-approval", async () => {
      console.log("[Sales Closer] Step 6: Storing draft for approval...");
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

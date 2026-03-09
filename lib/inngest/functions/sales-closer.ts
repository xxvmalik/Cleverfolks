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
import { draftOutreachEmail, executeEmailSend, DEFAULT_CADENCE } from "@/lib/email/resend-client";

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

    // Step 1: Create or fetch pipeline record
    const pipeline = await step.run("create-pipeline-record", async () => {
      const db = createAdminSupabaseClient();

      // If a pipeline record was already created by the entry point, fetch it
      if (existingPipelineId) {
        const { data: existing } = await db
          .from("skyler_sales_pipeline")
          .select("id, stage")
          .eq("id", existingPipelineId)
          .single();
        if (existing) {
          console.log(`[sales-closer] Using existing pipeline record ${existing.id}`);
          return { id: existing.id, existing: true };
        }
      }

      // Check for existing pipeline record by email
      const { data: byEmail } = await db
        .from("skyler_sales_pipeline")
        .select("id, stage")
        .eq("workspace_id", workspaceId)
        .eq("contact_email", contactEmail)
        .single();

      if (byEmail) {
        console.log(`[sales-closer] Contact ${contactEmail} already in pipeline (${byEmail.stage})`);
        return { id: byEmail.id, existing: true };
      }

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
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create pipeline record: ${error.message}`);
      console.log(`[sales-closer] Created pipeline record ${data!.id} for ${contactEmail}`);
      return { id: data!.id, existing: false };
    });

    if (pipeline.existing) {
      return { status: "skipped", reason: "already_in_pipeline" };
    }

    // Step 2: Research the company
    const research = await step.run("research-company", async () => {
      const db = createAdminSupabaseClient();
      return await researchCompany({
        companyName,
        contactName,
        contactEmail,
        workspaceId,
        pipelineId: pipeline.id,
        db,
      });
    });

    // Step 3: Learn sales voice (if not already learned)
    const voice = await step.run("learn-sales-voice", async () => {
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    // Step 4: Get relevant workspace memories for context
    const memories = await step.run("get-workspace-memories", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("workspace_memories")
        .select("content")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .in("type", ["pattern", "learning", "preference"])
        .order("times_reinforced", { ascending: false })
        .limit(10);
      return (data ?? []).map((m) => m.content as string);
    });

    // Step 5: Draft initial outreach email
    const draft = await step.run("draft-initial-email", async () => {
      return await draftEmail({
        workspaceId,
        pipelineRecord: {
          id: pipeline.id,
          contact_name: contactName,
          contact_email: contactEmail,
          company_name: companyName,
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
      const db = createAdminSupabaseClient();
      return await draftOutreachEmail(db, {
        workspaceId,
        pipelineId: pipeline.id,
        to: contactEmail,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        textBody: draft.textBody,
      });
    });

    // Step 7: Wait for approval (user approves or rejects via UI)
    const approval = await step.waitForEvent("wait-for-approval", {
      event: "skyler/email.approved",
      match: "data.pipelineId",
      timeout: "7d",
    });

    if (!approval) {
      await step.run("handle-timeout", async () => {
        const db = createAdminSupabaseClient();
        await db
          .from("skyler_sales_pipeline")
          .update({ stage: "stalled", updated_at: new Date().toISOString() })
          .eq("id", pipeline.id);
        // Reject the pending action
        await db
          .from("skyler_actions")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", action.actionId)
          .eq("status", "pending");
      });
      return { status: "stalled", reason: "approval_timeout" };
    }

    // Step 8: Send initial email (user approved)
    await step.run("send-initial-email", async () => {
      const db = createAdminSupabaseClient();
      await executeEmailSend(db, action.actionId);
    });

    // Step 9: Follow-up cadence loop
    for (const cadenceEntry of DEFAULT_CADENCE.slice(1)) {
      // Sleep until next follow-up
      await step.sleep(`wait-for-followup-${cadenceEntry.step}`, `${cadenceEntry.delay_days}d`);

      // Check if lead has replied
      const hasReplied = await step.run(`check-reply-${cadenceEntry.step}`, async () => {
        const db = createAdminSupabaseClient();
        const { data } = await db
          .from("skyler_sales_pipeline")
          .select("emails_replied, resolution")
          .eq("id", pipeline.id)
          .single();
        return (data?.emails_replied ?? 0) > 0 || !!data?.resolution;
      });

      if (hasReplied) {
        await step.run("handle-reply-received", async () => {
          const db = createAdminSupabaseClient();
          await db
            .from("skyler_sales_pipeline")
            .update({ stage: "negotiation", awaiting_reply: false, updated_at: new Date().toISOString() })
            .eq("id", pipeline.id);
        });
        return { status: "replied", cadence_step: cadenceEntry.step };
      }

      // Draft next follow-up
      const followUpDraft = await step.run(`draft-followup-${cadenceEntry.step}`, async () => {
        const db = createAdminSupabaseClient();
        const { data: latestPipeline } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", pipeline.id)
          .single();

        return await draftEmail({
          workspaceId,
          pipelineRecord: {
            id: pipeline.id,
            contact_name: contactName,
            contact_email: contactEmail,
            company_name: companyName,
            stage: latestPipeline?.stage ?? "follow_up_1",
            cadence_step: latestPipeline?.cadence_step ?? cadenceEntry.step - 1,
            conversation_thread: (latestPipeline?.conversation_thread ?? []) as Array<{ role: string; content: string; subject?: string; timestamp: string }>,
          },
          cadenceStep: cadenceEntry.step,
          companyResearch: research,
          salesVoice: voice,
          conversationThread: (latestPipeline?.conversation_thread ?? []) as Array<{ role: string; content: string; subject?: string; timestamp: string }>,
          workspaceMemories: memories,
        });
      });

      // Store follow-up draft for approval
      const followUpAction = await step.run(`store-followup-${cadenceEntry.step}`, async () => {
        const db = createAdminSupabaseClient();
        return await draftOutreachEmail(db, {
          workspaceId,
          pipelineId: pipeline.id,
          to: contactEmail,
          subject: followUpDraft.subject,
          htmlBody: followUpDraft.htmlBody,
          textBody: followUpDraft.textBody,
        });
      });

      // Wait for follow-up approval
      const followUpApproval = await step.waitForEvent(`wait-followup-approval-${cadenceEntry.step}`, {
        event: "skyler/email.approved",
        match: "data.pipelineId",
        timeout: "3d",
      });

      if (followUpApproval) {
        await step.run(`send-followup-${cadenceEntry.step}`, async () => {
          const db = createAdminSupabaseClient();
          await executeEmailSend(db, followUpAction.actionId);
        });
      }
    }

    // Step 10: Evaluate final outcome
    await step.run("evaluate-outcome", async () => {
      const db = createAdminSupabaseClient();
      const { data: final } = await db
        .from("skyler_sales_pipeline")
        .select("emails_replied, resolution")
        .eq("id", pipeline.id)
        .single();

      if ((final?.emails_replied ?? 0) === 0 && !final?.resolution) {
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "no_response",
            resolution_notes: "No response after full cadence (4 emails)",
            resolved_at: new Date().toISOString(),
            stage: "disqualified",
            updated_at: new Date().toISOString(),
          })
          .eq("id", pipeline.id);
      }
    });

    return { status: "completed", pipeline_id: pipeline.id };
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

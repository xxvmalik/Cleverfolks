/**
 * Sales Cadence Follow-Up System for Skyler Sales Closer.
 *
 * Two Inngest functions:
 * 1. salesCadenceScheduler — cron (hourly) finds pipeline records due for follow-up
 * 2. salesCadenceFollowUp  — drafts & stores the next follow-up email for approval
 *
 * The cadence is driven by `next_followup_at` set by executeEmailSend().
 * After step 4 (breakup) + 7-day grace, marks the lead as no_response.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { STAGES } from "@/lib/skyler/pipeline-stages";
import { researchCompany } from "@/lib/skyler/company-research";
import { getSalesVoice, learnSalesVoice } from "@/lib/skyler/voice-learner";
import { syncResolutionToHubSpot } from "@/lib/hubspot/crm-sync";
import { draftEmail } from "@/lib/skyler/email-drafter";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { buildSalesPlaybook } from "@/lib/skyler/sales-playbook";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";
import { dispatchNotification } from "@/lib/skyler/notifications";

// ── Cadence Scheduler (cron) ─────────────────────────────────────────────────
// Runs every hour. Finds pipeline records due for follow-up and dispatches events.

export const salesCadenceScheduler = inngest.createFunction(
  {
    id: "sales-cadence-scheduler",
    retries: 1,
  },
  { cron: "0 * * * *" }, // Every hour
  async ({ step }) => {
    // Step 1: Find records due for follow-up
    const dueRecords = await step.run("find-due-followups", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();

      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name, cadence_step, stage")
        .lte("next_followup_at", now)
        .is("resolution", null)
        .eq("awaiting_reply", true)
        .neq("cadence_paused", true)
        .lt("cadence_step", 4)
        .limit(50);

      if (error) {
        console.error("[cadence-scheduler] Query error:", error.message);
        return [];
      }

      console.log(`[cadence-scheduler] Found ${data?.length ?? 0} records due for follow-up`);
      return data ?? [];
    });

    // Step 2: Dispatch follow-up events
    if (dueRecords.length > 0) {
      await step.sendEvent(
        "dispatch-followups",
        dueRecords.map((r) => ({
          name: "skyler/cadence.followup.due" as const,
          data: {
            pipelineId: r.id,
            workspaceId: r.workspace_id,
            contactEmail: r.contact_email,
            contactName: r.contact_name,
            companyName: r.company_name,
            currentCadenceStep: r.cadence_step,
          },
        }))
      );
    }

    // Step 3: Close stale breakup leads (step 4 + 7-day grace period passed)
    const closedCount = await step.run("close-stale-breakups", async () => {
      const db = createAdminSupabaseClient();
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      const { data: stale } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name, hubspot_deal_id")
        .eq("cadence_step", 4)
        .is("resolution", null)
        .eq("awaiting_reply", true)
        .lte("last_email_sent_at", sevenDaysAgo)
        .limit(50);

      if (!stale || stale.length === 0) return 0;

      const now = new Date().toISOString();
      for (const record of stale) {
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "no_response",
            resolution_notes: "No reply after full 4-step cadence + 7-day grace period",
            resolved_at: now,
            awaiting_reply: false,
            stage: STAGES.STALLED,
            updated_at: now,
          })
          .eq("id", record.id);

        // Notify: deal closed lost (no response)
        dispatchNotification(db, {
          workspaceId: record.workspace_id,
          eventType: "deal_closed_lost",
          pipelineId: record.id,
          title: `No response: ${record.contact_name ?? record.contact_email}`,
          body: `No reply after full 4-step cadence + 7-day grace period.${record.company_name ? ` Company: ${record.company_name}` : ""}`,
          metadata: {
            contactName: record.contact_name,
            contactEmail: record.contact_email,
            companyName: record.company_name,
            resolution: "no_response",
          },
        }).catch((err) => console.error(`[cadence-scheduler] Notification failed for ${record.id}:`, err));

        // Sync resolution to HubSpot (fire-and-forget)
        syncResolutionToHubSpot({
          workspaceId: record.workspace_id,
          pipelineId: record.id,
          contactEmail: record.contact_email,
          contactName: record.contact_name ?? record.contact_email,
          companyName: record.company_name ?? undefined,
          resolution: "no_response",
          hubspotDealId: record.hubspot_deal_id ?? undefined,
        }).catch((err) => console.error(`[cadence-scheduler] CRM sync failed for ${record.id}:`, err));
      }

      console.log(`[cadence-scheduler] Closed ${stale.length} stale breakup leads as no_response`);
      return stale.length;
    });

    // Step 4: Mark leads as no_response if no reply 48h after the LAST follow-up
    // Only triggers when cadence_step >= maxFollowUpAttempts (from workspace settings)
    // These can be re-engaged if the lead replies later (reply-detector clears resolution)
    const noResponseCount = await step.run("mark-48h-no-response", async () => {
      const db = createAdminSupabaseClient();
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      // Find leads that have exhausted their cadence and still no reply after 48h
      // Exclude cadence_step=4 — those are handled by the breakup closer (Step 3 above)
      const { data: candidates } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name, cadence_step")
        .is("resolution", null)
        .eq("awaiting_reply", true)
        .lte("last_email_sent_at", fortyEightHoursAgo)
        .is("last_reply_at", null)
        .neq("cadence_step", 4)
        .limit(50);

      if (!candidates || candidates.length === 0) return 0;

      // Group by workspace to check each workspace's maxFollowUpAttempts
      const byWorkspace = new Map<string, typeof candidates>();
      for (const c of candidates) {
        const wId = c.workspace_id as string;
        if (!byWorkspace.has(wId)) byWorkspace.set(wId, []);
        byWorkspace.get(wId)!.push(c);
      }

      let count = 0;
      const now = new Date().toISOString();

      for (const [wsId, leads] of byWorkspace) {
        // Load workspace's maxFollowUpAttempts setting
        const { data: ws } = await db
          .from("workspaces")
          .select("settings")
          .eq("id", wsId)
          .single();

        const settings = (ws?.settings ?? {}) as Record<string, unknown>;
        const workflow = (settings.skyler_workflow ?? {}) as Record<string, unknown>;
        const maxAttempts = (workflow.maxFollowUpAttempts as number) ?? 4;

        // Only mark as no_response if cadence is fully exhausted
        const exhausted = leads.filter((l) => (l.cadence_step as number) >= maxAttempts);

        for (const record of exhausted) {
          await db
            .from("skyler_sales_pipeline")
            .update({
              resolution: "no_response",
              resolution_notes: `No reply within 48 hours after ${maxAttempts} follow-up attempts`,
              resolved_at: now,
              awaiting_reply: false,
              updated_at: now,
            })
            .eq("id", record.id);
          count++;
        }
      }

      if (count > 0) {
        console.log(`[cadence-scheduler] Marked ${count} leads as no_response (48h after final follow-up)`);
      }
      return count;
    });

    return {
      dispatched: dueRecords.length,
      closed_stale: closedCount,
      no_response_48h: noResponseCount,
    };
  }
);

// ── Cadence Follow-Up Handler ────────────────────────────────────────────────
// Triggered for each pipeline record due for follow-up.
// Loads context, drafts the next email, stores for approval.

export const salesCadenceFollowUp = inngest.createFunction(
  {
    id: "sales-cadence-followup",
    retries: 1,
    concurrency: [{ limit: 5 }], // Limit concurrent drafts
  },
  { event: "skyler/cadence.followup.due" },
  async ({ event, step }) => {
    const { pipelineId, workspaceId, contactEmail, contactName, companyName, currentCadenceStep } =
      event.data as {
        pipelineId: string;
        workspaceId: string;
        contactEmail: string;
        contactName: string;
        companyName: string;
        currentCadenceStep: number;
      };

    const nextStep = currentCadenceStep + 1;
    if (nextStep > 4) {
      console.log(`[cadence-followup] Pipeline ${pipelineId} already at step ${currentCadenceStep}, skipping`);
      return { status: "skipped", reason: "past_breakup" };
    }

    // Guard: re-check pipeline state (reply may have arrived since scheduler ran)
    const pipeline = await step.run("guard-check-pipeline", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("id", pipelineId)
        .single();

      if (!data) return null;

      // Abort if: reply received, resolved, or step already advanced
      if (data.resolution) return null;
      if (!data.awaiting_reply) return null;
      if ((data.cadence_step as number) !== currentCadenceStep) return null;
      if ((data.emails_replied as number) > 0) return null;

      return data;
    });

    if (!pipeline) {
      console.log(`[cadence-followup] Pipeline ${pipelineId} state changed, aborting follow-up`);
      return { status: "skipped", reason: "state_changed" };
    }

    // Load all context (same as initial workflow)
    const memories = await step.run("fetch-memories", async () => {
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

    const knowledgeProfile = await step.run("load-knowledge-profile", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("knowledge_profiles")
        .select("profile, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!data?.profile || !["ready", "pending_review"].includes(data.status ?? "")) return null;
      return data.profile as Record<string, unknown>;
    });

    const playbook = await step.run("build-playbook", async () => {
      const db = createAdminSupabaseClient();
      return await buildSalesPlaybook(db, workspaceId, memories, knowledgeProfile);
    });

    const research = await step.run("research-company", async () => {
      const db = createAdminSupabaseClient();
      return await researchCompany({
        companyName: (pipeline.company_name as string) || companyName,
        contactName: (pipeline.contact_name as string) || contactName,
        contactEmail: (pipeline.contact_email as string) || contactEmail,
        workspaceId,
        pipelineId,
        db,
        businessContext: memories.join("\n"),
        salesPlaybook: playbook,
      });
    });

    const voice = await step.run("learn-voice", async () => {
      const db = createAdminSupabaseClient();
      const existing = await getSalesVoice(db, workspaceId);
      if (existing) return existing;
      return await learnSalesVoice(db, workspaceId);
    });

    const senderIdentity = await step.run("load-sender-identity", async () => {
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

    // Build conversation thread from pipeline record
    const thread = (pipeline.conversation_thread ?? []) as Array<{
      role: string;
      content: string;
      subject?: string;
      timestamp: string;
    }>;

    // Build meeting context if this lead had a meeting
    const meetingOutcome = pipeline.meeting_outcome as Record<string, unknown> | null;
    const meetingContext = meetingOutcome ? {
      transcript: (pipeline.meeting_transcript as string) ?? undefined,
      outcome: meetingOutcome.outcome as string | undefined,
      reasoning: meetingOutcome.reasoning as string | undefined,
      keyPoints: meetingOutcome.key_discussion_points as string[] | undefined,
      followUpDate: meetingOutcome.follow_up_date as string | undefined,
    } : null;

    // Draft follow-up email
    const draft = await step.run("draft-followup-email", async () => {
      console.log(`[cadence-followup] Drafting step ${nextStep} for ${contactEmail}${meetingContext ? " [with meeting context]" : ""}`);

      return await draftEmail({
        workspaceId,
        pipelineRecord: {
          id: pipelineId,
          contact_name: (pipeline.contact_name as string) || contactName,
          contact_email: (pipeline.contact_email as string) || contactEmail,
          company_name: (pipeline.company_name as string) || companyName,
          stage: pipeline.stage as string,
          cadence_step: currentCadenceStep,
          conversation_thread: thread,
        },
        cadenceStep: nextStep,
        companyResearch: research,
        salesVoice: voice,
        conversationThread: thread,
        workspaceMemories: memories,
        salesPlaybook: playbook,
        knowledgeProfile,
        senderName: senderIdentity.senderName ?? undefined,
        senderCompany: senderIdentity.senderCompany ?? undefined,
        meetingContext,
      });
    });

    // Store draft for approval
    const action = await step.run("store-followup-draft", async () => {
      const db = createAdminSupabaseClient();
      return await draftOutreachEmail(db, {
        workspaceId,
        pipelineId,
        to: (pipeline.contact_email as string) || contactEmail,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        textBody: draft.textBody,
      });
    });

    // Set awaiting_reply to false while follow-up is pending approval
    // (executeEmailSend will set it back to true when sent)
    await step.run("mark-followup-pending", async () => {
      const db = createAdminSupabaseClient();
      await db
        .from("skyler_sales_pipeline")
        .update({
          awaiting_reply: false,
          next_followup_at: null, // Clear until email is actually sent
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineId);
    });

    // Notify: follow-up draft awaiting approval
    await step.run("notify-followup-draft-ready", async () => {
      const db = createAdminSupabaseClient();
      await dispatchNotification(db, {
        workspaceId,
        eventType: "draft_awaiting_approval",
        pipelineId,
        title: `Follow-up draft ready: ${pipeline.contact_name ?? contactName}`,
        body: `Step ${nextStep} follow-up to ${pipeline.contact_email ?? contactEmail} is ready for your approval.`,
        metadata: {
          contactName: pipeline.contact_name ?? contactName,
          contactEmail: pipeline.contact_email ?? contactEmail,
          companyName: pipeline.company_name ?? companyName,
          cadenceStep: nextStep,
        },
      });
    });

    console.log(`[cadence-followup] Step ${nextStep} draft stored for approval: ${action.actionId}`);
    return {
      status: "followup_draft_pending",
      pipeline_id: pipelineId,
      action_id: action.actionId,
      cadence_step: nextStep,
    };
  }
);

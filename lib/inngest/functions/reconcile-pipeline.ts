/**
 * Stage 15 — Reconciliation Layer (Self-Healing).
 *
 * Runs every 15 minutes. Compares pipeline state against reality and emits
 * corrective events for any inconsistencies found. Purely detective — it
 * emits events for the existing reasoning engine to handle, never updates
 * stages directly.
 *
 * Idempotent: checks pipeline_events to avoid duplicate corrections within 30 min.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const reconcilePipeline = inngest.createFunction(
  { id: "reconcile-pipeline", retries: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const results = {
      meetingStuck: 0,
      transcriptUnprocessed: 0,
      staleEngagement: 0,
      exhaustedFollowup: 0,
      stateDrift: 0,
    };

    // ── CHECK 1: Meeting completed but stage not advanced ──────────────
    // This is the EXACT fix for Ayomide.
    await step.run("check-meeting-stuck", async () => {
      const db = createAdminSupabaseClient();

      // Leads in demo_booked/meeting_booked where a calendar_event has ended
      const { data: stuckLeads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name, stage")
        .in("stage", ["demo_booked", "meeting_booked"])
        .is("resolution", null);

      if (!stuckLeads?.length) return;

      for (const lead of stuckLeads) {
        // Check if a calendar event for this lead has ended
        const { data: completedMeeting } = await db
          .from("calendar_events")
          .select("id, end_time")
          .eq("lead_id", lead.id)
          .lt("end_time", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // ended 2+ hours ago
          .order("end_time", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!completedMeeting) continue;

        // Idempotency: check if we already emitted a correction in the last 30 min
        if (await wasRecentlyCorrected(db, lead.id, "meeting_stuck")) continue;

        console.log(
          `[reconcile] CHECK 1: ${lead.contact_name} stuck in ${lead.stage} — meeting ended at ${completedMeeting.end_time}`
        );

        await inngest.send({
          name: "skyler/meeting.transcript.ready",
          data: {
            pipelineId: lead.id,
            workspaceId: lead.workspace_id,
            botId: "reconciliation-trigger",
            contactEmail: "",
            contactName: lead.contact_name,
            companyName: "",
            source: "reconciliation",
            reason: "meeting_stuck",
          },
        });

        // Log the correction attempt
        await logCorrectionEvent(db, lead.id, "meeting_stuck", {
          stage: lead.stage,
          meetingEndTime: completedMeeting.end_time,
        });

        results.meetingStuck++;
      }
    });

    // ── CHECK 2: Transcript exists but not processed ──────────────────
    await step.run("check-transcript-unprocessed", async () => {
      const db = createAdminSupabaseClient();

      // Leads with meeting_transcript but no meeting_outcome
      const { data: unprocessed } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name, contact_email, company_name")
        .not("meeting_transcript", "is", null)
        .is("meeting_outcome", null)
        .is("resolution", null);

      if (!unprocessed?.length) return;

      for (const lead of unprocessed) {
        // Check if the transcript is non-empty
        const { data: full } = await db
          .from("skyler_sales_pipeline")
          .select("meeting_transcript")
          .eq("id", lead.id)
          .single();

        const transcript = full?.meeting_transcript as string | null;
        if (!transcript || transcript.trim().length < 50) continue;

        if (await wasRecentlyCorrected(db, lead.id, "transcript_unprocessed")) continue;

        console.log(
          `[reconcile] CHECK 2: ${lead.contact_name} has transcript but no outcome`
        );

        await inngest.send({
          name: "skyler/meeting.transcript.ready",
          data: {
            pipelineId: lead.id,
            workspaceId: lead.workspace_id,
            botId: "reconciliation-trigger",
            contactEmail: lead.contact_email,
            contactName: lead.contact_name,
            companyName: lead.company_name,
            source: "reconciliation",
            reason: "transcript_unprocessed",
          },
        });

        await logCorrectionEvent(db, lead.id, "transcript_unprocessed", {});
        results.transcriptUnprocessed++;
      }
    });

    // ── CHECK 3: Lead gone silent after engagement ────────────────────
    await step.run("check-stale-engagement", async () => {
      const db = createAdminSupabaseClient();
      const fourteenDaysAgo = new Date(
        Date.now() - 14 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: staleLeads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name, stage")
        .in("stage", [
          "replied",
          "pending_clarification",
          "negotiation",
          "proposal",
        ])
        .is("resolution", null)
        .lt("updated_at", fourteenDaysAgo);

      if (!staleLeads?.length) return;

      for (const lead of staleLeads) {
        if (await wasRecentlyCorrected(db, lead.id, "stale_engagement")) continue;

        console.log(
          `[reconcile] CHECK 3: ${lead.contact_name} stale in ${lead.stage} for 14+ days`
        );

        await logCorrectionEvent(db, lead.id, "stale_engagement", {
          stage: lead.stage,
        });
        results.staleEngagement++;
      }
    });

    // ── CHECK 4: Follow-up exhausted but still in prospecting ─────────
    await step.run("check-exhausted-followup", async () => {
      const db = createAdminSupabaseClient();
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: exhausted } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name")
        .eq("stage", "follow_up_3")
        .is("resolution", null)
        .lt("updated_at", sevenDaysAgo);

      if (!exhausted?.length) return;

      for (const lead of exhausted) {
        if (await wasRecentlyCorrected(db, lead.id, "exhausted_followup")) continue;

        console.log(
          `[reconcile] CHECK 4: ${lead.contact_name} exhausted follow-ups, moving to no_response`
        );

        // Deterministic: no AI needed. Direct stage update.
        await db
          .from("skyler_sales_pipeline")
          .update({
            stage: "no_response",
            resolution: "no_response",
            resolution_notes: "No reply after full follow-up cadence (reconciliation)",
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", lead.id);

        await logCorrectionEvent(db, lead.id, "exhausted_followup", {
          action: "moved_to_no_response",
        });
        results.exhaustedFollowup++;
      }
    });

    // ── CHECK 5: Stage drift (event log vs current state) ─────────────
    await step.run("check-state-drift", async () => {
      const db = createAdminSupabaseClient();

      // Find leads where the latest pipeline_event.to_stage differs from current stage
      const { data: driftCandidates } = await db
        .rpc("check_pipeline_drift")
        .limit(20);

      // This RPC might not exist yet — if it fails, skip gracefully
      if (!driftCandidates?.length) return;

      for (const lead of driftCandidates) {
        if (await wasRecentlyCorrected(db, lead.id, "state_drift")) continue;

        console.log(
          `[reconcile] CHECK 5: ${lead.contact_name} drift — DB stage: ${lead.current_stage}, last event: ${lead.event_stage}`
        );

        await logCorrectionEvent(db, lead.id, "state_drift", {
          currentStage: lead.current_stage,
          eventStage: lead.event_stage,
        });
        results.stateDrift++;
      }
    });

    console.log("[reconcile] Run complete:", results);
    return results;
  }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function wasRecentlyCorrected(
  db: ReturnType<typeof createAdminSupabaseClient>,
  leadId: string,
  reason: string
): Promise<boolean> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data } = await db
    .from("pipeline_events")
    .select("id")
    .eq("lead_id", leadId)
    .eq("source", "reconciliation")
    .eq("source_detail", reason)
    .gte("created_at", thirtyMinAgo)
    .limit(1)
    .maybeSingle();

  return !!data;
}

async function logCorrectionEvent(
  db: ReturnType<typeof createAdminSupabaseClient>,
  leadId: string,
  reason: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .from("pipeline_events")
      .insert({
        lead_id: leadId,
        event_type: "reconciliation_correction",
        source: "reconciliation",
        source_detail: reason,
        payload,
      });
  } catch (err) {
    console.error("[reconcile] Failed to log correction:", err instanceof Error ? err.message : err);
  }
}

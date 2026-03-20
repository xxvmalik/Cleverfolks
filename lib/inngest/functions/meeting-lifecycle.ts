/**
 * Stage 15.1 Part B — Single Meeting Lifecycle Entry Point.
 *
 * ONE function handles the full lifecycle for every sales meeting,
 * regardless of how it was created (Skyler chat, calendar sync, Calendly, manual).
 *
 * Lifecycle steps:
 * 1. Pre-call brief (30 min before meeting start)
 * 2. Transcript recovery (5 min after meeting end, wait 5 min for webhook)
 * 3. No-show detection (if no transcript and no recording exist)
 * 4. Watchdog timer (emit stage-entered event for existing watchdog)
 *
 * Idempotency: Uses calendarEventId as the function's idempotency key.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallTranscriptRaw, getRecallBot, determineMeetingOutcome } from "@/lib/recall/client";

export const meetingLifecycleOrchestrator = inngest.createFunction(
  {
    id: "meeting-lifecycle-orchestrator",
    retries: 2,
    idempotency: "event.data.calendarEventId",
  },
  { event: "skyler/meeting.lifecycle-start" },
  async ({ event, step }) => {
    const { calendarEventId, workspaceId, pipelineId } = event.data as {
      calendarEventId: string;
      workspaceId: string;
      pipelineId: string;
    };

    // Step 1: Load calendar event details
    const calEvent = await step.run("load-calendar-event", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("calendar_events")
        .select("id, title, start_time, end_time, meeting_url, recall_bot_id, status, lead_id")
        .eq("id", calendarEventId)
        .single();

      if (!data) throw new Error(`Calendar event ${calendarEventId} not found`);
      return data as {
        id: string;
        title: string;
        start_time: string;
        end_time: string;
        meeting_url: string | null;
        recall_bot_id: string | null;
        status: string;
        lead_id: string | null;
      };
    });

    if (calEvent.status === "cancelled") {
      return { skipped: true, reason: "event_cancelled" };
    }

    const effectivePipelineId = pipelineId || calEvent.lead_id;
    if (!effectivePipelineId) {
      return { skipped: true, reason: "no_pipeline_id" };
    }

    // Step 2: Pre-call brief — sleep until 30 min before meeting start
    const startMs = new Date(calEvent.start_time).getTime();
    const briefTargetMs = startMs - 30 * 60 * 1000;
    const nowMs = Date.now();

    if (briefTargetMs > nowMs) {
      const sleepSecs = Math.max(Math.ceil((briefTargetMs - nowMs) / 1000), 1);
      await step.sleep("wait-for-brief-time", `${sleepSecs}s`);

      // Emit pre-call brief event (reuses existing function)
      await step.sendEvent("emit-pre-call-brief", {
        name: "skyler/meeting.pre-call-brief",
        data: {
          workspaceId,
          calendarEventId,
          pipelineId: effectivePipelineId,
          scheduledFor: new Date(briefTargetMs).toISOString(),
        },
      });
    }

    // Step 3: Wait until 5 minutes after meeting end
    const endMs = new Date(calEvent.end_time).getTime();
    const transcriptCheckMs = endMs + 5 * 60 * 1000;
    const nowMs2 = Date.now();

    if (transcriptCheckMs > nowMs2) {
      const sleepSecs = Math.max(Math.ceil((transcriptCheckMs - nowMs2) / 1000), 1);
      await step.sleep("wait-for-meeting-end", `${sleepSecs}s`);
    }

    // Step 4: Wait for transcript webhook (5 min timeout)
    const transcriptEvent = await step.waitForEvent("wait-for-transcript", {
      event: "skyler/meeting.transcript.ready",
      timeout: "5m",
      if: `async.data.pipelineId == '${effectivePipelineId}'`,
    });

    if (transcriptEvent) {
      // Transcript arrived via webhook — processing chain handles it
      // Emit watchdog event for the current stage
      await step.run("emit-watchdog-after-transcript", async () => {
        const db = createAdminSupabaseClient();
        const { data } = await db
          .from("skyler_sales_pipeline")
          .select("stage")
          .eq("id", effectivePipelineId)
          .single();
        if (data) {
          await inngest.send({
            name: "pipeline/lead.entered-stage",
            data: {
              leadId: effectivePipelineId,
              stage: data.stage,
              fromStage: data.stage,
              timestamp: new Date().toISOString(),
            },
          });
        }
      });

      return { status: "transcript_received_via_webhook", calendarEventId };
    }

    // Step 5: Transcript didn't arrive — try to fetch from Recall API
    const recoveryResult = await step.run("recover-transcript-from-recall", async () => {
      const db = createAdminSupabaseClient();

      // Reload calendar event to get latest recall_bot_id
      const { data: freshEvent } = await db
        .from("calendar_events")
        .select("recall_bot_id")
        .eq("id", calendarEventId)
        .single();

      // Also check pipeline for recall_bot_id
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("recall_bot_id, contact_email, contact_name, company_name")
        .eq("id", effectivePipelineId)
        .single();

      const botId = freshEvent?.recall_bot_id ?? pipeline?.recall_bot_id;

      if (!botId) {
        return { hasTranscript: false, hasBot: false, botId: null, pipeline };
      }

      // Try fetching transcript from Recall API
      try {
        const rawSegments = await getRecallTranscriptRaw(botId);

        if (rawSegments && rawSegments.length > 0) {
          // Transcript exists — save it
          const transcriptText = rawSegments
            .map((s) => `${s.speaker ?? "Unknown"}: ${(s.words ?? []).map((w: { text: string }) => w.text).join(" ")}`)
            .join("\n");

          if (transcriptText.trim().length > 50) {
            // Store on pipeline record
            await db
              .from("skyler_sales_pipeline")
              .update({
                meeting_transcript: transcriptText,
                updated_at: new Date().toISOString(),
              })
              .eq("id", effectivePipelineId);

            // Create meeting_transcripts record
            await db.from("meeting_transcripts").insert({
              bot_id: botId,
              workspace_id: workspaceId,
              lead_id: effectivePipelineId,
              raw_transcript: rawSegments,
              meeting_url: calEvent.meeting_url,
              meeting_date: calEvent.end_time,
              processing_status: "pending",
            });

            return { hasTranscript: true, hasBot: true, botId, pipeline };
          }
        }

        // Bot exists but no transcript (or too short) — possible no-show
        return { hasTranscript: false, hasBot: true, botId, pipeline };
      } catch {
        // Recall API error — don't falsely flag no-show, retry will handle
        console.error(`[meeting-lifecycle] Recall API error for bot ${botId}`);
        throw new Error(`Recall API unreachable for bot ${botId}`);
      }
    });

    // Step 6: If transcript recovered, emit processing event
    if (recoveryResult.hasTranscript && recoveryResult.botId) {
      const pipeline = recoveryResult.pipeline as {
        contact_email: string;
        contact_name: string;
        company_name: string;
      } | null;

      await step.sendEvent("emit-transcript-ready", {
        name: "skyler/meeting.transcript.ready",
        data: {
          pipelineId: effectivePipelineId,
          workspaceId,
          botId: recoveryResult.botId,
          contactEmail: pipeline?.contact_email ?? "",
          contactName: pipeline?.contact_name ?? "",
          companyName: pipeline?.company_name ?? "",
          source: "lifecycle_recovery",
        },
      });

      return { status: "transcript_recovered", calendarEventId };
    }

    // Step 7: No transcript — determine WHY via Recall bot metadata
    const outcomeResult = await step.run("determine-meeting-outcome", async () => {
      const db = createAdminSupabaseClient();
      const botId = recoveryResult.botId as string | null;

      if (!botId) {
        // No bot was ever created — we can't determine outcome
        return { outcome: "nobody_joined" as const, botId: null };
      }

      // Fetch full bot details including meeting_participants
      const botInfo = await getRecallBot(botId);
      if (!botInfo) {
        return { outcome: "nobody_joined" as const, botId };
      }

      // Get contact and host emails for participant matching
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("contact_email, workspace_id")
        .eq("id", effectivePipelineId)
        .single();

      // Get the workspace owner's email (the "host")
      let hostEmail: string | undefined;
      if (pipeline?.workspace_id) {
        const { data: workspace } = await db
          .from("workspaces")
          .select("owner_id")
          .eq("id", pipeline.workspace_id)
          .single();
        if (workspace?.owner_id) {
          const { data: profile } = await db
            .from("profiles")
            .select("email")
            .eq("id", workspace.owner_id)
            .single();
          hostEmail = profile?.email ?? undefined;
        }
      }

      const outcome = determineMeetingOutcome(
        botInfo,
        pipeline?.contact_email ?? undefined,
        hostEmail,
      );

      // Store outcome on the calendar event
      await db
        .from("calendar_events")
        .update({
          meeting_outcome_reason: outcome,
          updated_at: new Date().toISOString(),
        })
        .eq("id", calendarEventId);

      return { outcome, botId, statusChanges: botInfo.statusChanges, participants: botInfo.meetingParticipants };
    });

    // Step 8: Take action based on outcome
    const { outcome } = outcomeResult;

    if (outcome === "lead_no_show" || outcome === "nobody_joined") {
      // Lead didn't show — trigger no-show detection + re-engagement
      await step.sendEvent("emit-no-show", {
        name: "skyler/meeting.no-show-confirmed",
        data: {
          workspaceId,
          calendarEventId,
          pipelineId: effectivePipelineId,
          outcomeReason: outcome,
        },
      });
    } else if (outcome === "user_no_show") {
      // Host/user didn't show — notify them via Slack, don't penalise the lead
      await step.run("notify-user-no-show", async () => {
        const db = createAdminSupabaseClient();
        const { dispatchNotification } = await import("@/lib/skyler/notifications");

        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("contact_name, company_name")
          .eq("id", effectivePipelineId)
          .single();

        await dispatchNotification(db, {
          workspaceId,
          eventType: "meeting_no_show",
          pipelineId: effectivePipelineId,
          title: `You missed a meeting with ${pipeline?.contact_name ?? "a lead"}`,
          body: `${pipeline?.contact_name ?? "The lead"}${pipeline?.company_name ? ` from ${pipeline.company_name}` : ""} joined the meeting but you weren't there. Consider reaching out to apologise and reschedule.`,
          metadata: { calendarEventId, outcomeReason: outcome },
        });

        // Mark on calendar event
        await db
          .from("calendar_events")
          .update({ no_show_detected: false, updated_at: new Date().toISOString() })
          .eq("id", calendarEventId);
      });
    } else if (outcome === "recording_failed") {
      // Recording failed — try transcript recovery one more time
      await step.run("log-recording-failure", async () => {
        const db = createAdminSupabaseClient();
        try {
          await db.from("pipeline_events").insert({
            lead_id: effectivePipelineId,
            event_type: "recording_failed",
            source: "lifecycle",
            source_detail: `Bot ${outcomeResult.botId} had recording failure`,
            payload: { calendarEventId, botId: outcomeResult.botId },
          });
        } catch { /* audit logging should not block */ }
      });
    }

    return { status: `outcome_${outcome}`, calendarEventId, outcome };
  }
);

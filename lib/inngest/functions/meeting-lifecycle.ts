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
import { getRecallTranscriptRaw } from "@/lib/recall/client";

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

    // Step 7: No transcript and no recording — confirmed no-show
    await step.sendEvent("emit-no-show", {
      name: "skyler/meeting.no-show-confirmed",
      data: {
        workspaceId,
        calendarEventId,
        pipelineId: effectivePipelineId,
      },
    });

    return { status: "no_show_detected", calendarEventId };
  }
);

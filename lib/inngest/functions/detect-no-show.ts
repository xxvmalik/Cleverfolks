/**
 * No-Show Detection — Stage 15.1 (updated from Stage 13, Part H)
 *
 * Triggered by:
 * 1. Legacy path: "skyler/meeting.no-show-check" (15 min after meeting end)
 * 2. New lifecycle path: "skyler/meeting.no-show-confirmed" (from meeting-lifecycle.ts)
 *
 * Updates: Flags the no-show (doesn't change stage). Increments no_show_count
 * on the pipeline record. Triggers re-engagement sequence for first no-show,
 * or moves to closed_lost for repeat no-shows.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { markNoShow } from "@/lib/skyler/calendar/calendly-client";
import { validateAndLog } from "@/lib/skyler/pipeline/state-machine";

export const detectNoShow = inngest.createFunction(
  { id: "skyler-detect-no-show", retries: 2 },
  [
    { event: "skyler/meeting.no-show-check" },
    { event: "skyler/meeting.no-show-confirmed" },
  ],
  async ({ event, step }) => {
    const { workspaceId, calendarEventId, pipelineId, provider, inviteeUri } =
      event.data as {
        workspaceId: string;
        calendarEventId: string;
        pipelineId?: string;
        provider?: string;
        inviteeUri?: string;
      };

    // Step 1: Check if meeting actually happened (skip for lifecycle-confirmed events)
    const isLifecycleConfirmed = event.name === "skyler/meeting.no-show-confirmed";

    if (!isLifecycleConfirmed) {
      const checkResult = await step.run("check-meeting-status", async () => {
        const db = createAdminSupabaseClient();

        const { data: calEvent } = await db
          .from("calendar_events")
          .select("*, recall_bot_id, recall_bot_status, status, no_show_detected")
          .eq("id", calendarEventId)
          .single();

        if (!calEvent) return { skip: true, reason: "event_not_found" };
        if (calEvent.status === "cancelled") return { skip: true, reason: "event_cancelled" };
        if (calEvent.no_show_detected) return { skip: true, reason: "already_detected" };

        // Check if rescheduled
        const { data: rescheduled } = await db
          .from("calendar_events")
          .select("id")
          .eq("previous_event_id", calendarEventId)
          .limit(1);

        if (rescheduled && rescheduled.length > 0) {
          return { skip: true, reason: "event_rescheduled" };
        }

        // Check if Recall has a transcript (meeting happened)
        if (calEvent.recall_bot_id) {
          const { data: botRecord } = await db
            .from("recall_bots")
            .select("status, transcript_ready")
            .eq("bot_id", calEvent.recall_bot_id)
            .single();

          if (
            botRecord?.status === "in_call_recording" ||
            botRecord?.status === "done" ||
            botRecord?.transcript_ready
          ) {
            return { skip: true, reason: "meeting_occurred_per_recall" };
          }
        }

        // Check if any transcript exists for this meeting URL
        if (calEvent.meeting_url) {
          const { data: bots } = await db
            .from("recall_bots")
            .select("id")
            .eq("meeting_url", calEvent.meeting_url)
            .in("status", ["in_call_recording", "done"])
            .limit(1);

          if (bots && bots.length > 0) {
            return { skip: true, reason: "meeting_occurred_per_url" };
          }
        }

        return { skip: false };
      });

      if (checkResult.skip) {
        return { status: "skipped", reason: (checkResult as { reason?: string }).reason };
      }
    }

    // Step 2: Confirmed no-show — flag it, increment counter, create health signal
    const noShowResult = await step.run("mark-no-show", async () => {
      const db = createAdminSupabaseClient();

      // Mark on calendar event
      await db
        .from("calendar_events")
        .update({
          no_show_detected: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", calendarEventId);

      // If Calendly, call their API to mark as no-show
      if (provider === "calendly" && inviteeUri) {
        try {
          await markNoShow({ workspaceId, connectionId: workspaceId }, inviteeUri);
        } catch (err) {
          console.error("[detect-no-show] Calendly markNoShow failed:", err);
        }
      }

      // Increment no_show_count on pipeline record (not overwrite)
      if (pipelineId) {
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("no_show_count, stage, contact_name")
          .eq("id", pipelineId)
          .single();

        const currentCount = (pipeline?.no_show_count as number) ?? 0;
        const newCount = currentCount + 1;

        await db
          .from("skyler_sales_pipeline")
          .update({
            no_show_count: newCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pipelineId);

        const severity = newCount >= 2 ? "critical" : "high";

        // Create health signal
        try {
          await db.from("meeting_health_signals").insert({
            workspace_id: workspaceId,
            lead_id: pipelineId,
            signal_type: "no_show",
            severity,
            event_id: calendarEventId,
            details: {
              no_show_count: newCount,
              provider,
              message: newCount >= 2
                ? `Repeat no-show (${newCount} total). Lead may be disengaged.`
                : `First no-show detected. Starting re-engagement sequence.`,
            },
          });
        } catch { /* health signal logging should not block */ }

        // Log to pipeline_events
        try {
          await db.from("pipeline_events").insert({
            lead_id: pipelineId,
            event_type: "no_show_detected",
            from_stage: pipeline?.stage,
            source: "lifecycle",
            source_detail: `no_show_count: ${newCount}`,
            payload: { calendarEventId, provider, no_show_count: newCount },
          });
        } catch { /* audit logging should not block */ }

        // Notify user via Slack + in-app
        const calTitle = await db
          .from("calendar_events")
          .select("title")
          .eq("id", calendarEventId)
          .single()
          .then((r) => r.data?.title ?? "Meeting");

        await dispatchNotification(db, {
          workspaceId,
          eventType: "meeting_no_show",
          pipelineId,
          title: `No-show: ${pipeline?.contact_name ?? "Unknown"}`,
          body: newCount >= 2
            ? `${pipeline?.contact_name ?? "Lead"} no-showed again (${newCount} total). Moving to closed_lost.`
            : `${pipeline?.contact_name ?? "Lead"} missed the "${calTitle}" meeting. Starting re-engagement sequence.`,
          metadata: { calendarEventId, noShowCount: newCount },
        });

        return { noShowCount: newCount, stage: pipeline?.stage ?? "unknown" };
      }

      return { noShowCount: 1, stage: "unknown" };
    });

    // Step 3: Determine action based on no-show count
    if (noShowResult.noShowCount >= 2 && pipelineId) {
      // Repeat no-show → close_lost
      await step.run("close-repeat-no-show", async () => {
        const db = createAdminSupabaseClient();

        await validateAndLog(
          pipelineId,
          noShowResult.stage,
          "closed_lost",
          "no_show_detection",
          "repeat_no_show",
          { no_show_count: noShowResult.noShowCount },
        );

        await db
          .from("skyler_sales_pipeline")
          .update({
            stage: "closed_lost",
            resolution: "closed_lost",
            resolution_notes: `Repeat no-show (${noShowResult.noShowCount} total). Lead unresponsive.`,
            resolved_at: new Date().toISOString(),
            re_engagement_status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", pipelineId);

        console.log(`[detect-no-show] Repeat no-show for ${pipelineId} → closed_lost`);
      });

      return { status: "repeat_no_show_closed", pipelineId, noShowCount: noShowResult.noShowCount };
    }

    // First no-show → trigger re-engagement sequence
    if (pipelineId) {
      await step.sendEvent("trigger-reengagement", {
        name: "skyler/no-show.re-engage",
        data: {
          workspaceId,
          calendarEventId,
          pipelineId,
        },
      });
    }

    // Log to CRM
    await step.sendEvent("log-crm", {
      name: "skyler/crm.log-activity",
      data: {
        workspace_id: workspaceId,
        lead_id: pipelineId,
        activity_type: "meeting_no_show",
        payload: {
          calendar_event_id: calendarEventId,
          provider,
          no_show_count: noShowResult.noShowCount,
        },
      },
    });

    return { status: "no_show_detected", calendarEventId, pipelineId, noShowCount: noShowResult.noShowCount };
  }
);

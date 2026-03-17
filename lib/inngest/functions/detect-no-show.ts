/**
 * No-Show Detection — Stage 13, Part H
 *
 * Triggered 15 minutes after meeting END time.
 * Cross-platform: works for Calendly, Google Calendar, and Outlook.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { markNoShow } from "@/lib/skyler/calendar/calendly-client";

export const detectNoShow = inngest.createFunction(
  { id: "skyler-detect-no-show", retries: 2 },
  { event: "skyler/meeting.no-show-check" },
  async ({ event, step }) => {
    const { workspaceId, calendarEventId, pipelineId, provider, inviteeUri } =
      event.data as {
        workspaceId: string;
        calendarEventId: string;
        pipelineId?: string;
        provider?: string;
        inviteeUri?: string;
      };

    // Step 1: Check if meeting actually happened
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

      // Check if rescheduled (a newer event links back to this one)
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

      return { skip: false, calEvent };
    });

    if (checkResult.skip) {
      return { status: "skipped", reason: "skip" in checkResult ? (checkResult as { reason?: string }).reason : "unknown" };
    }

    const calEvent = "calEvent" in checkResult ? checkResult.calEvent : null;

    // Step 2: Confirmed no-show
    await step.run("mark-no-show", async () => {
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

      // Check no-show history for severity
      const { data: history } = await db
        .from("calendar_events")
        .select("id")
        .eq("lead_id", pipelineId)
        .eq("no_show_detected", true);

      const noShowCount = (history?.length ?? 0) + 1; // +1 for this one
      const severity = noShowCount >= 2 ? "critical" : "warning";

      // Create health signal
      await db.from("meeting_health_signals").insert({
        workspace_id: workspaceId,
        lead_id: pipelineId,
        signal_type: "no_show",
        severity,
        event_id: calendarEventId,
        details: {
          no_show_count: noShowCount,
          provider,
        },
      });

      // Notify user
      const title = calEvent?.title ?? "Meeting";
      await dispatchNotification(db, {
        workspaceId,
        eventType: "meeting_no_show",
        pipelineId: pipelineId ?? undefined,
        title: `No-show: ${title}`,
        body: `The attendee appears to have missed the meeting. I've drafted a follow-up.`,
        metadata: { calendarEventId, noShowCount },
      });
    });

    // Step 3: Trigger reasoning engine for follow-up
    await step.sendEvent("trigger-follow-up", {
      name: "skyler/meeting.no-show",
      data: {
        workspaceId,
        calendarEventId,
        pipelineId,
        provider,
      },
    });

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
        },
      },
    });

    return { status: "no_show_detected", calendarEventId, pipelineId };
  }
);

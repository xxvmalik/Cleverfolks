/**
 * Meeting Booking Flow — Inngest orchestration (Stage 13, Part F)
 *
 * Triggered when Skyler's reasoning engine decides to book a meeting.
 * Determines booking method, executes it, then schedules downstream tasks
 * (Recall bot, pre-call brief, no-show check).
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  getBookingMethod,
  getAvailableSlots,
  scoreTimeSlots,
  createMeetingEvent,
  scheduleRecallBot,
  getCalendlyConnection,
} from "@/lib/skyler/calendar/calendar-service";
import * as calendly from "@/lib/skyler/calendar/calendly-client";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  type SkylerWorkflowSettings,
} from "@/app/api/skyler/workflow-settings/route";

export const bookMeetingFlow = inngest.createFunction(
  { id: "skyler-book-meeting-flow", retries: 2 },
  { event: "skyler/meeting.book-requested" },
  async ({ event, step }) => {
    const {
      workspaceId,
      pipelineId,
      leadEmail,
      leadName,
      companyName,
      bookingMethodOverride,
      suggestedDuration,
      additionalAttendees,
      calendlyEventType,
    } = event.data as {
      workspaceId: string;
      pipelineId: string;
      leadEmail: string;
      leadName: string;
      companyName?: string;
      bookingMethodOverride?: string;
      suggestedDuration?: number;
      additionalAttendees?: string[];
      calendlyEventType?: string;
    };

    // Load workflow settings
    const settings = await step.run("load-settings", async () => {
      const db = createAdminSupabaseClient();
      const { data: ws } = await db
        .from("workspaces")
        .select("settings")
        .eq("id", workspaceId)
        .single();
      const raw = (ws?.settings ?? {}) as Record<string, unknown>;
      const workflow = raw.skyler_workflow as SkylerWorkflowSettings | undefined;
      return workflow ? { ...DEFAULT_WORKFLOW_SETTINGS, ...workflow } : DEFAULT_WORKFLOW_SETTINGS;
    });

    // Step 1: Determine booking method
    const method = await step.run("determine-method", async () => {
      if (bookingMethodOverride) return bookingMethodOverride;
      return await getBookingMethod(workspaceId, settings);
    });

    const duration = suggestedDuration ?? settings.defaultMeetingDuration ?? 30;

    // ── Step 2a: Calendly link ───────────────────────────────────────────────
    if (method === "calendly_link") {
      const bookingUrl = await step.run("get-calendly-link", async () => {
        const conn = await getCalendlyConnection(workspaceId);
        if (!conn) return null;

        const calendlyConn = { workspaceId, connectionId: workspaceId };
        const user = await calendly.getCurrentUser(calendlyConn);
        const eventTypes = await calendly.listEventTypes(calendlyConn, user.uri);

        // Find matching event type or use first active one
        let targetType = eventTypes[0];
        if (calendlyEventType) {
          const match = eventTypes.find(
            (et) =>
              et.slug === calendlyEventType ||
              et.name.toLowerCase().includes(calendlyEventType.toLowerCase())
          );
          if (match) targetType = match;
        }

        // Also check workspace stage mapping
        if (!targetType && settings.calendlyStageMapping) {
          // Try to find by pipeline stage mapping
        }

        if (!targetType) return null;

        // Create single-use scheduling link
        const link = await calendly.createSchedulingLink(calendlyConn, targetType.uri);
        return link.booking_url;
      });

      return {
        method: "calendly_link",
        bookingUrl,
        pipelineId,
        leadEmail,
        action: "include_in_email",
      };
    }

    // ── Step 2b: Suggest times ───────────────────────────────────────────────
    if (method === "suggest_times") {
      const suggestions = await step.run("get-time-suggestions", async () => {
        const now = new Date();
        const endRange = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 business days
        const slots = await getAvailableSlots(
          workspaceId,
          now.toISOString(),
          endRange.toISOString(),
          duration
        );

        if (!slots || slots.length === 0) return [];
        return scoreTimeSlots(slots);
      });

      if (suggestions.length === 0) {
        return {
          method: "suggest_times",
          error: "no_slots_available",
          pipelineId,
        };
      }

      // Format time suggestions
      const formatted = suggestions.map((s) => {
        const d = new Date(s.start);
        return d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        }) + " at " + d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      });

      // Wait for confirmation (reasoning engine sends email, prospect picks a time)
      const confirmation = await step.waitForEvent("wait-for-time-confirmation", {
        event: "skyler/meeting.time-confirmed",
        match: "data.pipelineId",
        timeout: "48h",
      });

      if (!confirmation) {
        // Timeout — trigger follow-up with fresh suggestions
        await inngest.send({
          name: "skyler/meeting.book-requested",
          data: { ...event.data, bookingMethodOverride: "suggest_times" },
        });
        return { method: "suggest_times", status: "timeout_requeued", pipelineId };
      }

      // Create the event
      const confirmedTime = confirmation.data.confirmedTime as string;
      const createdEvent = await step.run("create-event", async () => {
        const startTime = new Date(confirmedTime);
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

        return createMeetingEvent(workspaceId, {
          summary: `Meeting with ${leadName}${companyName ? ` (${companyName})` : ""}`,
          startDateTime: startTime.toISOString(),
          endDateTime: endTime.toISOString(),
          timeZone: tz,
          attendeeEmails: [leadEmail, ...(additionalAttendees ?? [])],
          leadId: pipelineId,
        });
      });

      if (createdEvent) {
        await schedulePostBookingTasks(step, workspaceId, pipelineId, createdEvent, settings);
      }

      return {
        method: "suggest_times",
        suggestedTimes: formatted,
        confirmedTime,
        createdEvent,
        pipelineId,
      };
    }

    // ── Step 2c: Direct invite ───────────────────────────────────────────────
    if (method === "direct_invite") {
      const createdEvent = await step.run("create-direct-event", async () => {
        const now = new Date();
        const endRange = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
        const slots = await getAvailableSlots(
          workspaceId,
          now.toISOString(),
          endRange.toISOString(),
          duration
        );

        if (!slots || slots.length === 0) return null;

        const best = scoreTimeSlots(slots)[0];
        if (!best) return null;

        const startTime = new Date(best.start);
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

        return createMeetingEvent(workspaceId, {
          summary: `Meeting with ${leadName}${companyName ? ` (${companyName})` : ""}`,
          startDateTime: startTime.toISOString(),
          endDateTime: endTime.toISOString(),
          timeZone: tz,
          attendeeEmails: [leadEmail, ...(additionalAttendees ?? [])],
          leadId: pipelineId,
        });
      });

      if (createdEvent) {
        await schedulePostBookingTasks(step, workspaceId, pipelineId, createdEvent, settings);
      }

      return { method: "direct_invite", createdEvent, pipelineId };
    }

    // ── Step 2d: Ask availability (no calendar) ──────────────────────────────
    // Surface request_info asking user to connect calendar or provide times
    return {
      method: "ask_availability",
      pipelineId,
      action: "request_info",
      message:
        "I need to suggest meeting times but I don't have access to your calendar. Please connect your calendar in Settings, or tell me what times work for you this week.",
    };
  }
);

// ── Post-booking tasks ───────────────────────────────────────────────────────
// Now delegates to the unified meeting-lifecycle-orchestrator (Stage 15.1).
// Keeps Recall bot scheduling and CRM logging here since they're booking-specific.

async function schedulePostBookingTasks(
  step: { sendEvent: (id: string, events: { name: string; data: Record<string, unknown> } | Array<{ name: string; data: Record<string, unknown> }>) => Promise<unknown> },
  workspaceId: string,
  pipelineId: string,
  createdEvent: { id: string; meetingUrl: string | null; start: string; end: string; provider: string },
  _settings: SkylerWorkflowSettings
) {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];

  // Emit unified lifecycle event — handles pre-call brief, transcript recovery, and no-show detection
  events.push({
    name: "skyler/meeting.lifecycle-start",
    data: {
      calendarEventId: createdEvent.id,
      workspaceId,
      pipelineId,
    },
  });

  // Schedule Recall bot (booking-specific — lifecycle doesn't handle this)
  if (createdEvent.meetingUrl) {
    events.push({
      name: "skyler/meeting.schedule-bot",
      data: {
        workspaceId,
        calendarEventId: createdEvent.id,
        meetingUrl: createdEvent.meetingUrl,
      },
    });
  }

  // Log CRM activity
  events.push({
    name: "skyler/crm.log-activity",
    data: {
      workspace_id: workspaceId,
      lead_id: pipelineId,
      activity_type: "meeting_booked",
      payload: {
        meeting_id: createdEvent.id,
        start: createdEvent.start,
        end: createdEvent.end,
        meeting_url: createdEvent.meetingUrl,
        provider: createdEvent.provider,
      },
    },
  });

  if (events.length > 0) {
    await step.sendEvent("schedule-post-booking", events);
  }
}

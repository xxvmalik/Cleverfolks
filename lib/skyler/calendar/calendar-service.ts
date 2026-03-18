/**
 * Unified Calendar Service — abstraction layer over Google, Outlook, and Calendly.
 *
 * The reasoning engine and all Inngest functions call THIS service,
 * never the provider-specific clients directly.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";
import * as googleCal from "./google-calendar-client";
import * as msGraph from "./microsoft-graph-client";
import * as calendly from "./calendly-client";
import { createRecallBot } from "@/lib/recall/client";
import type { SkylerWorkflowSettings } from "@/app/api/skyler/workflow-settings/route";

// ── Types ────────────────────────────────────────────────────────────────────

export type CalendarConnection = {
  id: string;
  workspace_id: string;
  provider: "google_calendar" | "microsoft_outlook" | "calendly";
  provider_email: string | null;
  recall_calendar_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  oauth_status: string;
  work_hours_start: string;
  work_hours_end: string;
  work_days: number[];
  timezone: string;
  calendly_event_types: unknown;
  metadata: Record<string, unknown>;
};

export type TimeSlot = {
  start: string; // ISO
  end: string;   // ISO
  score: number;
};

export type BookingMethod =
  | "calendly_link"
  | "suggest_times"
  | "direct_invite"
  | "ask_availability";

export type CreatedEvent = {
  id: string;
  providerEventId: string;
  meetingUrl: string | null;
  start: string;
  end: string;
  provider: string;
};

// ── Connection lookup ────────────────────────────────────────────────────────

/** Get the user's calendar connection(s) for a workspace */
export async function getCalendarConnections(
  workspaceId: string
): Promise<CalendarConnection[]> {
  const db = createAdminSupabaseClient();
  const { data } = await db
    .from("calendar_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("oauth_status", "connected");

  return (data ?? []) as unknown as CalendarConnection[];
}

/** Get primary calendar connection (Google or Outlook — NOT Calendly) */
export async function getPrimaryCalendarConnection(
  workspaceId: string
): Promise<CalendarConnection | null> {
  const connections = await getCalendarConnections(workspaceId);
  // Prefer Google Calendar, then Outlook
  return (
    connections.find((c) => c.provider === "google_calendar") ??
    connections.find((c) => c.provider === "microsoft_outlook") ??
    null
  );
}

/** Get Calendly connection */
export async function getCalendlyConnection(
  workspaceId: string
): Promise<CalendarConnection | null> {
  const connections = await getCalendarConnections(workspaceId);
  return connections.find((c) => c.provider === "calendly") ?? null;
}

// ── Availability ─────────────────────────────────────────────────────────────

/**
 * Get available time slots by checking the user's real calendar.
 * Returns null if no calendar is connected (triggers knowledge gap → request_info).
 */
export async function getAvailableSlots(
  workspaceId: string,
  startDate: string,
  endDate: string,
  durationMinutes: number
): Promise<TimeSlot[] | null> {
  const connection = await getPrimaryCalendarConnection(workspaceId);
  if (!connection) return null;

  if (connection.provider === "google_calendar") {
    if (!connection.access_token_encrypted || !connection.refresh_token_encrypted) return null;

    const busyBlocks = await googleCal.checkAvailability(
      {
        id: connection.id,
        access_token_encrypted: connection.access_token_encrypted,
        refresh_token_encrypted: connection.refresh_token_encrypted,
        token_expires_at: connection.token_expires_at,
      },
      startDate,
      endDate
    );

    return invertBusyBlocks(
      busyBlocks.map((b) => ({ start: b.start, end: b.end })),
      startDate,
      endDate,
      durationMinutes,
      connection.work_hours_start,
      connection.work_hours_end,
      connection.work_days,
      connection.timezone
    );
  }

  if (connection.provider === "microsoft_outlook") {
    const email = connection.provider_email ?? "";
    const result = await msGraph.checkAvailability(
      workspaceId,
      email,
      startDate,
      endDate
    );

    const workHoursStart = result.workingHours?.startTime ?? connection.work_hours_start;
    const workHoursEnd = result.workingHours?.endTime ?? connection.work_hours_end;

    return invertBusyBlocks(
      result.busyBlocks.map((b) => ({
        start: b.start.dateTime,
        end: b.end.dateTime,
      })),
      startDate,
      endDate,
      durationMinutes,
      workHoursStart,
      workHoursEnd,
      connection.work_days,
      connection.timezone
    );
  }

  return null;
}

// ── Slot scoring ─────────────────────────────────────────────────────────────

/**
 * Score time slots based on heuristics.
 * Returns top 3 across different days.
 */
export function scoreTimeSlots(
  slots: TimeSlot[],
  prospectTimezone?: string
): TimeSlot[] {
  const scored = slots.map((slot) => {
    let score = 0;
    const start = new Date(slot.start);
    const day = start.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    // Tuesday through Thursday: +20
    if (day >= 2 && day <= 4) score += 20;

    // Monday morning / Friday afternoon: -30
    if (day === 1 && start.getUTCHours() < 12) score -= 30;
    if (day === 5 && start.getUTCHours() >= 14) score -= 30;

    // 10am-2pm in user's local timezone: +15
    const hour = start.getUTCHours();
    if (hour >= 10 && hour <= 14) score += 15;

    // Check prospect timezone if provided
    if (prospectTimezone) {
      try {
        const prospectHour = parseInt(
          new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            hour12: false,
            timeZone: prospectTimezone,
          }).format(start)
        );
        if (prospectHour >= 9 && prospectHour <= 17) score += 15;
      } catch {
        // Invalid timezone, skip scoring
      }
    }

    return { ...slot, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Pick top 3 across different days
  const seen = new Set<string>();
  const top: TimeSlot[] = [];
  for (const slot of scored) {
    const dayKey = new Date(slot.start).toISOString().split("T")[0];
    if (!seen.has(dayKey)) {
      seen.add(dayKey);
      top.push(slot);
      if (top.length >= 3) break;
    }
  }

  // If we don't have 3 different days, fill from remaining
  if (top.length < 3) {
    for (const slot of scored) {
      if (!top.includes(slot)) {
        top.push(slot);
        if (top.length >= 3) break;
      }
    }
  }

  return top;
}

// ── Meeting creation ─────────────────────────────────────────────────────────

/** Create a calendar event with a video link via the connected provider */
export async function createMeetingEvent(
  workspaceId: string,
  eventData: {
    summary: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
    attendeeEmails: string[];
    description?: string;
    leadId?: string;
  }
): Promise<CreatedEvent | null> {
  const connection = await getPrimaryCalendarConnection(workspaceId);
  if (!connection) return null;

  const db = createAdminSupabaseClient();

  if (connection.provider === "google_calendar") {
    if (!connection.access_token_encrypted || !connection.refresh_token_encrypted) return null;

    const event = await googleCal.createEventWithMeet(
      {
        id: connection.id,
        access_token_encrypted: connection.access_token_encrypted,
        refresh_token_encrypted: connection.refresh_token_encrypted,
        token_expires_at: connection.token_expires_at,
      },
      eventData
    );

    const meetingUrl = googleCal.extractMeetingUrl(event);

    // Resolve lead from attendee emails if not explicitly provided
    const leadId = eventData.leadId ?? await resolveLeadFromAttendees(workspaceId, eventData.attendeeEmails);

    // Store in calendar_events
    const { data: calEvent } = await db
      .from("calendar_events")
      .insert({
        calendar_connection_id: connection.id,
        workspace_id: workspaceId,
        provider: "google_calendar",
        provider_event_id: event.id,
        title: eventData.summary,
        description: eventData.description,
        start_time: eventData.startDateTime,
        end_time: eventData.endDateTime,
        timezone: eventData.timeZone,
        meeting_url: meetingUrl,
        meeting_provider: "google_meet",
        attendees: eventData.attendeeEmails.map((e) => ({
          email: e,
          response_status: "needsAction",
        })),
        status: "confirmed",
        lead_id: leadId,
      })
      .select("id")
      .single();

    // Schedule no-show check + pre-call brief
    if (calEvent?.id) {
      await scheduleNoShowCheck({
        workspaceId,
        calendarEventId: calEvent.id,
        leadId: leadId,
        endTime: eventData.endDateTime,
        provider: "google_calendar",
      });
    }

    return {
      id: calEvent?.id ?? "",
      providerEventId: event.id,
      meetingUrl,
      start: eventData.startDateTime,
      end: eventData.endDateTime,
      provider: "google_calendar",
    };
  }

  if (connection.provider === "microsoft_outlook") {
    const event = await msGraph.createEventWithTeams(workspaceId, {
      subject: eventData.summary,
      startDateTime: eventData.startDateTime,
      endDateTime: eventData.endDateTime,
      timeZone: eventData.timeZone,
      attendees: eventData.attendeeEmails.map((e) => ({ email: e })),
      body: eventData.description,
    });

    const meetingUrl = msGraph.extractTeamsUrl(event);

    // Resolve lead from attendee emails if not explicitly provided
    const leadId = eventData.leadId ?? await resolveLeadFromAttendees(workspaceId, eventData.attendeeEmails);

    const { data: calEvent } = await db
      .from("calendar_events")
      .insert({
        calendar_connection_id: connection.id,
        workspace_id: workspaceId,
        provider: "microsoft_outlook",
        provider_event_id: event.id,
        title: eventData.summary,
        description: eventData.description,
        start_time: eventData.startDateTime,
        end_time: eventData.endDateTime,
        timezone: eventData.timeZone,
        meeting_url: meetingUrl,
        meeting_provider: "teams",
        attendees: eventData.attendeeEmails.map((e) => ({
          email: e,
          response_status: "none",
        })),
        status: "confirmed",
        lead_id: leadId,
      })
      .select("id")
      .single();

    // Schedule no-show check
    if (calEvent?.id) {
      await scheduleNoShowCheck({
        workspaceId,
        calendarEventId: calEvent.id,
        leadId: leadId,
        endTime: eventData.endDateTime,
        provider: "microsoft_outlook",
      });
    }

    return {
      id: calEvent?.id ?? "",
      providerEventId: event.id,
      meetingUrl,
      start: eventData.startDateTime,
      end: eventData.endDateTime,
      provider: "microsoft_outlook",
    };
  }

  return null;
}

// ── Attendee management ──────────────────────────────────────────────────────

/** Add attendees to an existing calendar event */
export async function addAttendeesToEvent(
  workspaceId: string,
  calendarEventId: string,
  newAttendees: Array<{ email: string; name?: string }>
): Promise<boolean> {
  const db = createAdminSupabaseClient();

  const { data: calEvent } = await db
    .from("calendar_events")
    .select("*, calendar_connections(*)")
    .eq("id", calendarEventId)
    .single();

  if (!calEvent) return false;

  const existingAttendees = (calEvent.attendees as Array<{ email: string }>) ?? [];
  const allAttendees = [
    ...existingAttendees,
    ...newAttendees.map((a) => ({ email: a.email, response_status: "needsAction" })),
  ];

  if (calEvent.provider === "google_calendar") {
    const conn = calEvent.calendar_connections as unknown as CalendarConnection;
    if (!conn?.access_token_encrypted || !conn?.refresh_token_encrypted) return false;

    await googleCal.updateEventAttendees(
      {
        id: conn.id,
        access_token_encrypted: conn.access_token_encrypted,
        refresh_token_encrypted: conn.refresh_token_encrypted,
        token_expires_at: conn.token_expires_at,
      },
      calEvent.provider_event_id,
      allAttendees.map((a) => ({ email: a.email }))
    );
  } else if (calEvent.provider === "microsoft_outlook") {
    await msGraph.updateEventAttendees(
      workspaceId,
      calEvent.provider_event_id,
      allAttendees.map((a) => ({ email: a.email }))
    );
  } else {
    return false;
  }

  // Update in DB
  await db
    .from("calendar_events")
    .update({ attendees: allAttendees, updated_at: new Date().toISOString() })
    .eq("id", calendarEventId);

  return true;
}

// ── Booking method ───────────────────────────────────────────────────────────

/**
 * Determine the preferred booking method based on connections and settings.
 */
export async function getBookingMethod(
  workspaceId: string,
  workflowSettings?: SkylerWorkflowSettings
): Promise<BookingMethod> {
  const connections = await getCalendarConnections(workspaceId);
  const hasCalendly = connections.some((c) => c.provider === "calendly");
  const hasCalendar = connections.some(
    (c) => c.provider === "google_calendar" || c.provider === "microsoft_outlook"
  );

  const bookDemosUsing = workflowSettings?.bookDemosUsing?.toLowerCase() ?? "";

  if (hasCalendly && bookDemosUsing.includes("calendly")) {
    return "calendly_link";
  }
  if (hasCalendar && bookDemosUsing.includes("suggest")) {
    return "suggest_times";
  }
  if (hasCalendar && bookDemosUsing.includes("direct")) {
    return "direct_invite";
  }
  if (hasCalendar) {
    return "suggest_times"; // default if calendar connected
  }
  if (hasCalendly) {
    return "calendly_link"; // fallback to Calendly if it's all they have
  }

  return "ask_availability";
}

// ── Schedule Recall bot ──────────────────────────────────────────────────────

/** Schedule a Recall AI bot to join a meeting if auto-join is enabled */
export async function scheduleRecallBot(
  workspaceId: string,
  calendarEventId: string,
  meetingUrl: string
): Promise<string | null> {
  try {
    const db = createAdminSupabaseClient();

    // Check if auto-join is enabled
    const { data: ws } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();

    const settings = (ws?.settings ?? {}) as Record<string, unknown>;
    const meetingSettings = (settings.skyler_meeting ?? {}) as Record<string, unknown>;

    if (!meetingSettings.autoJoinMeetings) return null;

    const botName = (meetingSettings.botDisplayName as string) || "Skyler AI";

    const result = await createRecallBot({
      meetingUrl,
      botName,
    });

    // Update calendar event with bot info
    if (result?.id) {
      await db
        .from("calendar_events")
        .update({
          recall_bot_id: result.id,
          recall_bot_status: "scheduled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", calendarEventId);
    }

    return result?.id ?? null;
  } catch (err) {
    console.error("[calendar-service] Failed to schedule Recall bot:", err);
    return null;
  }
}

// ── No-Show Scheduling ────────────────────────────────────────────────────────

/**
 * Schedule a no-show check for a calendar event.
 * Fires 15 minutes after the meeting end time.
 * Only schedules for confirmed events with a linked lead (sales meetings).
 */
export async function scheduleNoShowCheck(params: {
  workspaceId: string;
  calendarEventId: string;
  leadId: string | null;
  endTime: string;
  provider?: string;
}): Promise<void> {
  // Only schedule for sales meetings (has a lead linked)
  if (!params.leadId) return;

  const endDate = new Date(params.endTime);
  const checkAt = new Date(endDate.getTime() + 15 * 60 * 1000);

  // Don't schedule for events that already ended more than 2 hours ago
  if (checkAt.getTime() < Date.now() - 2 * 60 * 60 * 1000) return;

  try {
    await inngest.send({
      name: "skyler/meeting.no-show-check",
      data: {
        workspaceId: params.workspaceId,
        calendarEventId: params.calendarEventId,
        pipelineId: params.leadId,
        provider: params.provider,
      },
      ts: checkAt.getTime(),
    } as { name: string; data: Record<string, unknown>; ts?: number });

    console.log(`[calendar-service] No-show check scheduled for ${checkAt.toISOString()} (event ${params.calendarEventId})`);
  } catch (err) {
    console.error("[calendar-service] Failed to schedule no-show check:", err);
  }
}

// ── Lead Matching ─────────────────────────────────────────────────────────────

/**
 * Match attendee emails against pipeline records to find the lead_id.
 * Checks all attendee emails against skyler_sales_pipeline.contact_email.
 * Returns the first match's pipeline ID, or null.
 */
export async function resolveLeadFromAttendees(
  workspaceId: string,
  attendeeEmails: string[]
): Promise<string | null> {
  if (!attendeeEmails.length) return null;

  const db = createAdminSupabaseClient();

  // Get the workspace owner's email so we can exclude it from matching
  const { data: members } = await db
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1);

  let ownerEmail: string | null = null;
  if (members?.[0]) {
    const { data: profile } = await db
      .from("profiles")
      .select("email")
      .eq("id", members[0].user_id)
      .single();
    ownerEmail = profile?.email?.toLowerCase() ?? null;
  }

  // Filter out the owner's email — we only want external attendees
  const externalEmails = attendeeEmails.filter(
    (e) => e.toLowerCase() !== ownerEmail
  );

  for (const email of externalEmails) {
    const { data: match } = await db
      .from("skyler_sales_pipeline")
      .select("id")
      .ilike("contact_email", email)
      .is("resolution", null)
      .limit(1)
      .maybeSingle();

    if (match) return match.id;
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Invert busy blocks into free slots within work hours */
function invertBusyBlocks(
  busyBlocks: Array<{ start: string; end: string }>,
  rangeStart: string,
  rangeEnd: string,
  durationMinutes: number,
  workHoursStart: string,
  workHoursEnd: string,
  workDays: number[],
  _timezone: string
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const durationMs = durationMinutes * 60 * 1000;

  // Sort busy blocks
  const sorted = [...busyBlocks].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  // Iterate day by day
  const current = new Date(start);
  while (current < end) {
    const dayOfWeek = current.getDay(); // 0=Sun
    // Convert to Mon=1 format
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;

    if (workDays.includes(isoDay)) {
      const [startH, startM] = workHoursStart.split(":").map(Number);
      const [endH, endM] = workHoursEnd.split(":").map(Number);

      const dayStart = new Date(current);
      dayStart.setUTCHours(startH, startM, 0, 0);

      const dayEnd = new Date(current);
      dayEnd.setUTCHours(endH, endM, 0, 0);

      // Find free windows in this day
      let cursor = dayStart.getTime();
      const dayBusy = sorted.filter((b) => {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        return be > dayStart.getTime() && bs < dayEnd.getTime();
      });

      for (const block of dayBusy) {
        const blockStart = new Date(block.start).getTime();
        if (blockStart - cursor >= durationMs) {
          slots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(cursor + durationMs).toISOString(),
            score: 0,
          });
        }
        cursor = Math.max(cursor, new Date(block.end).getTime());
      }

      // After last busy block
      if (dayEnd.getTime() - cursor >= durationMs) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + durationMs).toISOString(),
          score: 0,
        });
      }
    }

    // Next day
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return slots;
}

/**
 * Microsoft Graph API client for Outlook/Teams calendar operations.
 * Recall Calendar V2 handles READ. This handles WRITE:
 * - getSchedule availability (returns workingHours — better than Google)
 * - Event creation with Teams meeting links
 * - Attendee updates
 * - Working hours retrieval
 *
 * Uses Nango proxy for token management (same `outlook` provider key as email).
 */

import { Nango } from "@nangohq/node";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

type ScheduleItem = {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: string;
};

type WorkingHours = {
  daysOfWeek: string[];
  startTime: string;
  endTime: string;
  timeZone: { name: string };
};

type OutlookEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{
    emailAddress: { address: string; name: string };
    type: string;
    status: { response: string };
  }>;
  onlineMeeting?: { joinUrl: string };
  webLink: string;
  isOnlineMeeting: boolean;
};

// ── Nango proxy helper ───────────────────────────────────────────────────────

function getNango(): Nango {
  return new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
}

async function graphGet<T>(
  workspaceId: string,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "GET",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: workspaceId,
    params,
  });
  return resp.data as T;
}

async function graphPost<T>(
  workspaceId: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "POST",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: workspaceId,
    data: body,
  });
  return resp.data as T;
}

async function graphPatch<T>(
  workspaceId: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "PATCH",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: workspaceId,
    data: body,
  });
  return resp.data as T;
}

// ── API methods ──────────────────────────────────────────────────────────────

/** Check availability via getSchedule — returns busy blocks AND working hours */
export async function checkAvailability(
  workspaceId: string,
  userEmail: string,
  startDate: string,
  endDate: string
): Promise<{
  busyBlocks: ScheduleItem[];
  workingHours: WorkingHours | null;
}> {
  const data = await graphPost<{
    value: Array<{
      scheduleItems: ScheduleItem[];
      workingHours?: WorkingHours;
    }>;
  }>(workspaceId, "/me/calendar/getSchedule", {
    schedules: [userEmail],
    startTime: { dateTime: startDate, timeZone: "UTC" },
    endTime: { dateTime: endDate, timeZone: "UTC" },
    availabilityViewInterval: 30,
  });

  const schedule = data.value?.[0];
  return {
    busyBlocks: schedule?.scheduleItems ?? [],
    workingHours: schedule?.workingHours ?? null,
  };
}

/** Create a calendar event with a Teams meeting link */
export async function createEventWithTeams(
  workspaceId: string,
  eventData: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
    attendees: Array<{ email: string; name?: string }>;
    body?: string;
  }
): Promise<OutlookEvent> {
  return graphPost<OutlookEvent>(workspaceId, "/me/events", {
    subject: eventData.subject,
    body: eventData.body
      ? { contentType: "HTML", content: eventData.body }
      : undefined,
    start: { dateTime: eventData.startDateTime, timeZone: eventData.timeZone },
    end: { dateTime: eventData.endDateTime, timeZone: eventData.timeZone },
    attendees: eventData.attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name ?? a.email },
      type: "required",
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
  });
}

/** Update attendees on an existing event */
export async function updateEventAttendees(
  workspaceId: string,
  eventId: string,
  attendees: Array<{ email: string; name?: string; type?: string }>
): Promise<OutlookEvent> {
  return graphPatch<OutlookEvent>(workspaceId, `/me/events/${eventId}`, {
    attendees: attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name ?? a.email },
      type: a.type ?? "required",
    })),
  });
}

/** Get the user's working hours from Outlook settings */
export async function getWorkingHours(
  workspaceId: string
): Promise<WorkingHours | null> {
  try {
    const data = await graphGet<{
      workingHours: WorkingHours;
    }>(workspaceId, "/me/mailboxSettings/workingHours");
    return data.workingHours ?? null;
  } catch {
    return null;
  }
}

/** Extract the Teams meeting URL from an Outlook event */
export function extractTeamsUrl(event: OutlookEvent): string | null {
  return event.onlineMeeting?.joinUrl ?? null;
}

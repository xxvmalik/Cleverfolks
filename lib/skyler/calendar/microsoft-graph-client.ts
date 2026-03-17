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
  nangoConnectionId: string,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "GET",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: nangoConnectionId,
    params,
  });
  return resp.data as T;
}

async function graphPost<T>(
  nangoConnectionId: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "POST",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: nangoConnectionId,
    data: body,
  });
  return resp.data as T;
}

async function graphPatch<T>(
  nangoConnectionId: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "PATCH",
    baseUrlOverride: GRAPH_BASE,
    endpoint: path,
    providerConfigKey: "outlook",
    connectionId: nangoConnectionId,
    data: body,
  });
  return resp.data as T;
}

/**
 * Resolve the Nango connection ID for the Outlook provider.
 * Looks up the `integrations` table by workspace ID.
 */
export async function resolveNangoConnectionId(
  workspaceId: string
): Promise<string | null> {
  const { createAdminSupabaseClient } = await import("@/lib/supabase-admin");
  const db = createAdminSupabaseClient();
  const { data } = await db
    .from("integrations")
    .select("nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .single();
  return data?.nango_connection_id ?? null;
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
  const connId = await resolveNangoConnectionId(workspaceId);
  if (!connId) throw new Error("No connected Outlook integration found");

  const data = await graphPost<{
    value: Array<{
      scheduleItems: ScheduleItem[];
      workingHours?: WorkingHours;
    }>;
  }>(connId, "/me/calendar/getSchedule", {
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
  const connId = await resolveNangoConnectionId(workspaceId);
  if (!connId) throw new Error("No connected Outlook integration found");
  return graphPost<OutlookEvent>(connId, "/me/events", {
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
  const connId = await resolveNangoConnectionId(workspaceId);
  if (!connId) throw new Error("No connected Outlook integration found");
  return graphPatch<OutlookEvent>(connId, `/me/events/${eventId}`, {
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
    const connId = await resolveNangoConnectionId(workspaceId);
    if (!connId) return null;
    const data = await graphGet<{
      workingHours: WorkingHours;
    }>(connId, "/me/mailboxSettings/workingHours");
    return data.workingHours ?? null;
  } catch {
    return null;
  }
}

/** Get the user's email from Microsoft Graph /me endpoint */
export async function getUserEmail(
  workspaceId: string
): Promise<string | null> {
  const connId = await resolveNangoConnectionId(workspaceId);
  if (!connId) return null;
  try {
    const me = await graphGet<{ mail?: string; userPrincipalName?: string }>(
      connId,
      "/me"
    );
    return me.mail ?? me.userPrincipalName ?? null;
  } catch {
    return null;
  }
}

/** Extract the Teams meeting URL from an Outlook event */
export function extractTeamsUrl(event: OutlookEvent): string | null {
  return event.onlineMeeting?.joinUrl ?? null;
}

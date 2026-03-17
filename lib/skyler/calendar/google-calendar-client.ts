/**
 * Google Calendar write operations for Skyler.
 * Recall Calendar V2 handles READ (event monitoring). This handles WRITE:
 * - freeBusy availability checks
 * - Event creation with Google Meet links
 * - Attendee updates
 * - Timezone detection
 *
 * Token refresh: checks token_expires_at before every call, refreshes if <60s to expiry.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const GOOGLE_API = "https://www.googleapis.com";

type CalendarConnection = {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
};

type BusyBlock = { start: string; end: string };

type GoogleEvent = {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; responseStatus: string }>;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
  htmlLink: string;
};

// ── Token management ─────────────────────────────────────────────────────────

async function ensureValidToken(connection: CalendarConnection): Promise<string> {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
  const now = new Date();

  // If token is still valid (>60s to expiry), use it
  if (expiresAt && expiresAt.getTime() - now.getTime() > 60_000) {
    return connection.access_token_encrypted;
  }

  // Refresh the token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      refresh_token: connection.refresh_token_encrypted,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google token refresh failed: ${err}`);
  }

  const tokens = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Update token in DB
  const db = createAdminSupabaseClient();
  await db
    .from("calendar_connections")
    .update({
      access_token_encrypted: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

async function googleFetch<T>(
  connection: CalendarConnection,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await ensureValidToken(connection);
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google Calendar API error (${resp.status}): ${err}`);
  }

  return resp.json() as Promise<T>;
}

// ── API methods ──────────────────────────────────────────────────────────────

/** Check free/busy for the user's primary calendar */
export async function checkAvailability(
  connection: CalendarConnection,
  startDate: string,
  endDate: string
): Promise<BusyBlock[]> {
  const data = await googleFetch<{
    calendars: Record<string, { busy: BusyBlock[] }>;
  }>(connection, `${GOOGLE_API}/calendar/v3/freeBusy`, {
    method: "POST",
    body: JSON.stringify({
      timeMin: startDate,
      timeMax: endDate,
      items: [{ id: "primary" }],
    }),
  });

  return data.calendars?.primary?.busy ?? [];
}

/** Create a calendar event with a Google Meet link */
export async function createEventWithMeet(
  connection: CalendarConnection,
  eventData: {
    summary: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
    attendeeEmails: string[];
    description?: string;
  }
): Promise<GoogleEvent> {
  // conferenceDataVersion=1 is MANDATORY for Meet link creation
  const url = `${GOOGLE_API}/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`;

  return googleFetch<GoogleEvent>(connection, url, {
    method: "POST",
    body: JSON.stringify({
      summary: eventData.summary,
      description: eventData.description,
      start: { dateTime: eventData.startDateTime, timeZone: eventData.timeZone },
      end: { dateTime: eventData.endDateTime, timeZone: eventData.timeZone },
      attendees: eventData.attendeeEmails.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  });
}

/** Update attendees on an existing event */
export async function updateEventAttendees(
  connection: CalendarConnection,
  eventId: string,
  attendees: Array<{ email: string; responseStatus?: string }>
): Promise<GoogleEvent> {
  const url = `${GOOGLE_API}/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`;

  return googleFetch<GoogleEvent>(connection, url, {
    method: "PATCH",
    body: JSON.stringify({ attendees }),
  });
}

/** Get the user's calendar timezone */
export async function getUserTimezone(
  connection: CalendarConnection
): Promise<string> {
  const data = await googleFetch<{ value: string }>(
    connection,
    `${GOOGLE_API}/calendar/v3/users/me/settings/timezone`
  );
  return data.value;
}

/** Extract the Meet/video link from a Google Calendar event */
export function extractMeetingUrl(event: GoogleEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video"
  );
  return videoEntry?.uri ?? null;
}

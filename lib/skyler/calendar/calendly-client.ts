/**
 * Calendly API v2 client for Skyler.
 * Handles event types, scheduled events, invitees, no-shows, and webhook management.
 * Auth: OAuth 2.0 via Nango proxy.
 */

import { Nango } from "@nangohq/node";

const CALENDLY_BASE = "https://api.calendly.com";

type CalendlyConnection = {
  workspaceId: string;
  connectionId?: string;
};

// ── Types ────────────────────────────────────────────────────────────────────

export type CalendlyEventType = {
  uri: string;
  name: string;
  slug: string;
  duration: number;
  scheduling_url: string;
  active: boolean;
  kind: string;
};

export type CalendlyScheduledEvent = {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  event_type: string;
  location?: {
    type: string;
    join_url?: string;
    location?: string;
  };
  invitees_counter: { total: number; active: number; limit: number };
  created_at: string;
  updated_at: string;
  event_memberships: Array<{ user: string; user_email: string }>;
  calendar_event?: { external_created_at: string; kind: string };
};

export type CalendlyInvitee = {
  uri: string;
  email: string;
  name: string;
  status: "active" | "canceled";
  timezone: string;
  created_at: string;
  questions_and_answers: Array<{
    position: number;
    question: string;
    answer: string;
  }>;
  rescheduled: boolean;
  old_invitee?: string;
  new_invitee?: string;
  cancel_url: string;
  reschedule_url: string;
  cancellation?: {
    canceled_by: string;
    reason: string;
    canceler_type: "host" | "invitee";
  };
};

// ── Nango proxy helper ───────────────────────────────────────────────────────

function getNango(): Nango {
  return new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
}

async function calendlyGet<T>(
  conn: CalendlyConnection,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "GET",
    baseUrlOverride: CALENDLY_BASE,
    endpoint: path,
    providerConfigKey: "calendly",
    connectionId: conn.connectionId ?? conn.workspaceId,
    params,
  });
  return resp.data as T;
}

async function calendlyPost<T>(
  conn: CalendlyConnection,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const nango = getNango();
  const resp = await nango.proxy({
    method: "POST",
    baseUrlOverride: CALENDLY_BASE,
    endpoint: path,
    providerConfigKey: "calendly",
    connectionId: conn.connectionId ?? conn.workspaceId,
    data: body,
  });
  return resp.data as T;
}

// ── API methods ──────────────────────────────────────────────────────────────

/** Get the current user's URI and email */
export async function getCurrentUser(conn: CalendlyConnection): Promise<{
  uri: string;
  email: string;
  name: string;
  scheduling_url: string;
}> {
  const data = await calendlyGet<{ resource: { uri: string; email: string; name: string; scheduling_url: string } }>(
    conn,
    "/users/me"
  );
  return data.resource;
}

/** List all event types for a user */
export async function listEventTypes(
  conn: CalendlyConnection,
  userUri: string
): Promise<CalendlyEventType[]> {
  const data = await calendlyGet<{ collection: CalendlyEventType[] }>(
    conn,
    "/event_types",
    { user: userUri, active: "true" }
  );
  return data.collection;
}

/** Get a single scheduled event by URI */
export async function getScheduledEvent(
  conn: CalendlyConnection,
  eventUri: string
): Promise<CalendlyScheduledEvent> {
  // eventUri is a full URL like https://api.calendly.com/scheduled_events/UUID
  const uuid = eventUri.split("/").pop()!;
  const data = await calendlyGet<{ resource: CalendlyScheduledEvent }>(
    conn,
    `/scheduled_events/${uuid}`
  );
  return data.resource;
}

/** Get invitees for a scheduled event */
export async function getEventInvitees(
  conn: CalendlyConnection,
  eventUri: string
): Promise<CalendlyInvitee[]> {
  const uuid = eventUri.split("/").pop()!;
  const data = await calendlyGet<{ collection: CalendlyInvitee[] }>(
    conn,
    `/scheduled_events/${uuid}/invitees`
  );
  return data.collection;
}

/** Get a single invitee by URI */
export async function getInvitee(
  conn: CalendlyConnection,
  inviteeUri: string
): Promise<CalendlyInvitee> {
  // inviteeUri is full URL
  const parts = inviteeUri.split("/");
  const inviteeUuid = parts.pop()!;
  const eventUuid = parts[parts.indexOf("scheduled_events") + 1];
  const data = await calendlyGet<{ resource: CalendlyInvitee }>(
    conn,
    `/scheduled_events/${eventUuid}/invitees/${inviteeUuid}`
  );
  return data.resource;
}

/** Mark an invitee as no-show */
export async function markNoShow(
  conn: CalendlyConnection,
  inviteeUri: string
): Promise<void> {
  await calendlyPost(conn, "/invitee_no_shows", { invitee: inviteeUri });
}

/** Create a single-use scheduling link for a given event type */
export async function createSchedulingLink(
  conn: CalendlyConnection,
  eventTypeUri: string
): Promise<{ booking_url: string; owner: string }> {
  const data = await calendlyPost<{ resource: { booking_url: string; owner: string } }>(
    conn,
    "/scheduling_links",
    {
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: "EventType",
    }
  );
  return data.resource;
}

/** Create a webhook subscription */
export async function createWebhookSubscription(
  conn: CalendlyConnection,
  callbackUrl: string,
  events: string[],
  organizationUri: string,
  scope: "user" | "organization" = "user",
  userUri?: string
): Promise<{ uri: string }> {
  const body: Record<string, unknown> = {
    url: callbackUrl,
    events,
    organization: organizationUri,
    scope,
  };
  if (scope === "user" && userUri) {
    body.user = userUri;
  }
  const data = await calendlyPost<{ resource: { uri: string } }>(
    conn,
    "/webhook_subscriptions",
    body
  );
  return data.resource;
}

/** List scheduled events within a time range */
export async function listScheduledEvents(
  conn: CalendlyConnection,
  userUri: string,
  minStartTime: string,
  maxStartTime: string
): Promise<CalendlyScheduledEvent[]> {
  const data = await calendlyGet<{ collection: CalendlyScheduledEvent[] }>(
    conn,
    "/scheduled_events",
    {
      user: userUri,
      min_start_time: minStartTime,
      max_start_time: maxStartTime,
      status: "active",
    }
  );
  return data.collection;
}

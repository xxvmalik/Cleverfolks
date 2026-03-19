/**
 * Calendar meeting checker for Skyler Sales Closer.
 *
 * Runs every 10 minutes via cron. For each workspace with active pipeline
 * records, queries connected calendar providers (Google Calendar, Outlook
 * Calendar, Calendly) for events where attendees match pipeline contacts.
 *
 * When a match is found, marks the pipeline record as meeting_booked.
 */

import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { detectPipelineMeeting, type MeetingRecord } from "@/lib/sync/meeting-detector";
import { createRecallBot, isSupportedMeetingUrl } from "@/lib/recall/client";

// ── Cron: Meeting Check ─────────────────────────────────────────────────────

export const meetingCheckScheduler = inngest.createFunction(
  {
    id: "meeting-check-scheduler",
    retries: 1,
  },
  { cron: "*/10 * * * *" }, // Every 10 minutes
  async ({ step }) => {
    // Step 1: Find workspaces with unresolved pipeline records
    const workspaces = await step.run("find-active-workspaces", async () => {
      const db = createAdminSupabaseClient();

      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .select("workspace_id")
        .is("resolution", null)
        .limit(100);

      if (error || !data) return [];

      const unique = [...new Set(data.map((r) => r.workspace_id as string))];
      console.log(`[meeting-check] Found ${unique.length} workspaces with active pipelines`);
      return unique;
    });

    if (workspaces.length === 0) return { checked: 0, meetings: 0 };

    // Step 2: Check each workspace for calendar meetings
    let totalMeetings = 0;

    for (const workspaceId of workspaces) {
      const meetings = await step.run(`check-workspace-${workspaceId.slice(0, 8)}`, async () => {
        return await checkWorkspaceMeetings(workspaceId);
      });
      totalMeetings += meetings;
    }

    console.log(`[meeting-check] Done. Checked ${workspaces.length} workspaces, found ${totalMeetings} new meetings`);
    return { checked: workspaces.length, meetings: totalMeetings };
  }
);

// ── Core logic ──────────────────────────────────────────────────────────────

async function checkWorkspaceMeetings(workspaceId: string): Promise<number> {
  const db = createAdminSupabaseClient();

  // Get connected calendar providers
  const { data: integrations } = await db
    .from("integrations")
    .select("provider, nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", ["google-calendar", "outlook", "calendly"]);

  if (!integrations || integrations.length === 0) return 0;

  // Get active pipeline contact emails for matching
  const { data: pipelines } = await db
    .from("skyler_sales_pipeline")
    .select("contact_email")
    .eq("workspace_id", workspaceId)
    .is("resolution", null)
    .limit(100);

  if (!pipelines || pipelines.length === 0) return 0;

  const contactEmails = new Set(
    pipelines.map((p) => (p.contact_email as string).toLowerCase())
  );

  console.log(`[meeting-check] Workspace ${workspaceId.slice(0, 8)}: ${contactEmails.size} contacts, ${integrations.length} calendar provider(s)`);

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  let meetingsFound = 0;

  for (const integration of integrations) {
    try {
      let events: MeetingRecord[] = [];

      if (integration.provider === "google-calendar") {
        events = await fetchGoogleCalendarEvents(nango, integration.nango_connection_id);
      } else if (integration.provider === "outlook") {
        events = await fetchOutlookCalendarEvents(nango, integration.nango_connection_id);
      } else if (integration.provider === "calendly") {
        events = await fetchCalendlyEvents(nango, integration.nango_connection_id);
      }

      // Match events against pipeline contacts
      for (const event of events) {
        const matchingAttendees = event.attendeeEmails.filter((e) =>
          contactEmails.has(e.toLowerCase())
        );

        if (matchingAttendees.length === 0) continue;

        console.log(`[meeting-check] Match: "${event.title}" has pipeline contact(s): ${matchingAttendees.join(", ")}`);

        const result = await detectPipelineMeeting(db, workspaceId, event);
        if (result.detected) {
          meetingsFound++;
          console.log(`[meeting-check] Meeting booked: ${result.contact_email} → pipeline ${result.pipeline_id}`);

          // Ensure calendar_events row exists for this event
          const providerEventId = event.eventId.replace(/^(gcal|outlook|calendly)-/, "");
          const providerName = event.provider === "google-calendar" ? "google_calendar"
            : event.provider === "outlook" ? "microsoft_outlook"
            : event.provider;
          let calendarEventId: string | null = null;

          try {
            // Check if row already exists (dedup by workspace + provider_event_id)
            const { data: existing } = await db
              .from("calendar_events")
              .select("id")
              .eq("workspace_id", workspaceId)
              .eq("provider_event_id", providerEventId)
              .maybeSingle();

            if (existing) {
              calendarEventId = existing.id;
              // Update lead_id if not set
              await db
                .from("calendar_events")
                .update({ lead_id: result.pipeline_id, updated_at: new Date().toISOString() })
                .eq("id", existing.id)
                .is("lead_id", null);
            } else {
              // Insert new calendar_events row
              const attendeesJson = event.attendeeEmails.map((email) => ({ email }));
              const { data: inserted } = await db
                .from("calendar_events")
                .insert({
                  workspace_id: workspaceId,
                  provider: providerName,
                  provider_event_id: providerEventId,
                  title: event.title,
                  start_time: event.startTime,
                  end_time: event.endTime,
                  meeting_url: event.meetingLink ?? null,
                  meeting_provider: detectMeetingProvider(event.meetingLink),
                  attendees: attendeesJson,
                  status: "confirmed",
                  lead_id: result.pipeline_id,
                })
                .select("id")
                .single();

              if (inserted) {
                calendarEventId = inserted.id;
                console.log(`[meeting-check] Created calendar_events row ${inserted.id} for "${event.title}"`);
              }
            }
          } catch (calErr) {
            console.warn(`[meeting-check] Failed to upsert calendar_event:`, calErr instanceof Error ? calErr.message : calErr);
          }

          // Dispatch Recall.ai bot to join the meeting (if supported platform link exists)
          if (result.meetingLink && result.pipeline_id) {
            if (!isSupportedMeetingUrl(result.meetingLink)) {
              console.log(`[meeting-check] Skipping Recall bot — unsupported meeting URL: ${result.meetingLink}`);
            } else {
              try {
                const bot = await createRecallBot({
                  meetingUrl: result.meetingLink,
                  botName: "Skyler Notetaker",
                  joinAt: result.startTime,
                  metadata: {
                    workspace_id: workspaceId,
                    lead_id: result.pipeline_id!,
                  },
                });

                // Store bot ID on pipeline record for webhook matching
                await db
                  .from("skyler_sales_pipeline")
                  .update({ recall_bot_id: bot.id, updated_at: new Date().toISOString() })
                  .eq("id", result.pipeline_id);

                // Also store in recall_bots table
                await db.from("recall_bots").insert({
                  recall_bot_id: bot.id,
                  workspace_id: workspaceId,
                  lead_id: result.pipeline_id,
                  meeting_url: result.meetingLink,
                  scheduled_join_at: result.startTime,
                  status: "scheduled",
                  bot_name: "Skyler Notetaker",
                });

                // Link bot to calendar_events row
                if (calendarEventId) {
                  await db
                    .from("calendar_events")
                    .update({ recall_bot_id: bot.id, recall_bot_status: "scheduled" })
                    .eq("id", calendarEventId);
                }

                console.log(`[meeting-check] Recall bot ${bot.id} scheduled for pipeline ${result.pipeline_id}`);
              } catch (recallErr) {
                console.error(`[meeting-check] Failed to create Recall bot:`, recallErr instanceof Error ? recallErr.message : recallErr);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[meeting-check] Error checking ${integration.provider}:`, err instanceof Error ? err.message : err);
    }
  }

  return meetingsFound;
}

// ── Google Calendar ─────────────────────────────────────────────────────────

async function fetchGoogleCalendarEvents(
  nango: Nango,
  connectionId: string
): Promise<MeetingRecord[]> {
  const events: MeetingRecord[] = [];

  try {
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const future7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://www.googleapis.com",
      endpoint: `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(past24h)}&timeMax=${encodeURIComponent(future7d)}&singleEvents=true&maxResults=50&orderBy=startTime`,
      connectionId,
      providerConfigKey: "google-calendar",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (response as any)?.data?.items;
    if (!items || items.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items) {
      // Skip cancelled events
      if (item.status === "cancelled") continue;

      const attendees: string[] = [];
      if (Array.isArray(item.attendees)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of item.attendees as any[]) {
          // Skip the organizer (that's the user) and declined attendees
          if (a.self) continue;
          if (a.responseStatus === "declined") continue;
          if (a.email) attendees.push(a.email.toLowerCase());
        }
      }

      if (attendees.length === 0) continue;

      events.push({
        eventId: `gcal-${item.id}`,
        attendeeEmails: attendees,
        title: item.summary ?? "(No Title)",
        startTime: item.start?.dateTime ?? item.start?.date ?? "",
        endTime: item.end?.dateTime ?? item.end?.date ?? "",
        meetingLink: item.hangoutLink ?? item.conferenceData?.entryPoints?.[0]?.uri ?? undefined,
        provider: "google-calendar",
      });
    }

    console.log(`[meeting-check] Google Calendar: fetched ${events.length} events with attendees`);
  } catch (err) {
    console.error("[meeting-check] Google Calendar fetch failed:", err instanceof Error ? err.message : err);
  }

  return events;
}

// ── Outlook Calendar ────────────────────────────────────────────────────────

async function fetchOutlookCalendarEvents(
  nango: Nango,
  connectionId: string
): Promise<MeetingRecord[]> {
  const events: MeetingRecord[] = [];

  try {
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const future7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/calendarView?startDateTime=${encodeURIComponent(past24h)}&endDateTime=${encodeURIComponent(future7d)}&$top=50&$select=id,subject,start,end,attendees,onlineMeetingUrl,onlineMeeting,isOnlineMeeting,isCancelled`,
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (response as any)?.data?.value;
    if (!items || items.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items) {
      if (item.isCancelled) continue;

      const attendees: string[] = [];
      if (Array.isArray(item.attendees)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of item.attendees as any[]) {
          const email = a.emailAddress?.address?.toLowerCase();
          // Skip declined attendees
          if (a.status?.response === "declined") continue;
          if (email) attendees.push(email);
        }
      }

      if (attendees.length === 0) continue;

      events.push({
        eventId: `outlook-${item.id}`,
        attendeeEmails: attendees,
        title: item.subject ?? "(No Title)",
        startTime: item.start?.dateTime ?? "",
        endTime: item.end?.dateTime ?? "",
        meetingLink: item.onlineMeeting?.joinUrl ?? item.onlineMeetingUrl ?? undefined,
        provider: "outlook",
      });
    }

    console.log(`[meeting-check] Outlook Calendar: fetched ${events.length} events with attendees`);
    for (const e of events) {
      console.log(`[meeting-check] Event "${e.title}": meetingLink=${e.meetingLink ?? "none"}`);
    }
  } catch (err) {
    console.error("[meeting-check] Outlook Calendar fetch failed:", err instanceof Error ? err.message : err);
  }

  return events;
}

// ── Calendly ────────────────────────────────────────────────────────────────

async function fetchCalendlyEvents(
  nango: Nango,
  connectionId: string
): Promise<MeetingRecord[]> {
  const events: MeetingRecord[] = [];

  try {
    // Step 1: Get current user URI
    const meResponse = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://api.calendly.com",
      endpoint: "/users/me",
      connectionId,
      providerConfigKey: "calendly",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userUri = (meResponse as any)?.data?.resource?.uri;
    if (!userUri) {
      console.warn("[meeting-check] Calendly: could not get user URI");
      return [];
    }

    // Step 2: List scheduled events
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const future7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const eventsResponse = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://api.calendly.com",
      endpoint: `/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${encodeURIComponent(past24h)}&max_start_time=${encodeURIComponent(future7d)}&status=active&count=20`,
      connectionId,
      providerConfigKey: "calendly",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduledEvents = (eventsResponse as any)?.data?.collection;
    if (!scheduledEvents || scheduledEvents.length === 0) return [];

    // Step 3: For each event, fetch invitees to get their emails
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const event of scheduledEvents) {
      try {
        // Extract event UUID from URI (format: https://api.calendly.com/scheduled_events/UUID)
        const eventUuid = event.uri?.split("/").pop();
        if (!eventUuid) continue;

        const inviteesResponse = await nango.proxy({
          method: "GET",
          baseUrlOverride: "https://api.calendly.com",
          endpoint: `/scheduled_events/${eventUuid}/invitees?count=10`,
          connectionId,
          providerConfigKey: "calendly",
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invitees = (inviteesResponse as any)?.data?.collection;
        if (!invitees || invitees.length === 0) continue;

        const attendees: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const inv of invitees) {
          if (inv.email) attendees.push(inv.email.toLowerCase());
        }

        if (attendees.length === 0) continue;

        events.push({
          eventId: `calendly-${eventUuid}`,
          attendeeEmails: attendees,
          title: event.name ?? "(Calendly Meeting)",
          startTime: event.start_time ?? "",
          endTime: event.end_time ?? "",
          meetingLink: event.location?.join_url ?? undefined,
          provider: "calendly",
        });
      } catch (invErr) {
        console.error("[meeting-check] Calendly invitee fetch failed:", invErr instanceof Error ? invErr.message : invErr);
      }
    }

    console.log(`[meeting-check] Calendly: fetched ${events.length} events with invitees`);
  } catch (err) {
    console.error("[meeting-check] Calendly fetch failed:", err instanceof Error ? err.message : err);
  }

  return events;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function detectMeetingProvider(url?: string): string | null {
  if (!url) return null;
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("meet.google.com")) return "google_meet";
  if (url.includes("teams.microsoft.com")) return "teams";
  if (url.includes("webex.com")) return "webex";
  return null;
}

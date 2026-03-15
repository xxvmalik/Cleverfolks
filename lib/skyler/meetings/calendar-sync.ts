/**
 * Calendar Sync for Skyler Meeting Intelligence.
 *
 * Uses Recall AI's Calendar V2 API to auto-detect meetings with pipeline leads
 * and schedule recording bots. Works via webhook-driven sync (not polling).
 *
 * Flow:
 * 1. User connects calendar via OAuth → we pass credentials to Recall
 * 2. Recall syncs events and sends calendar.sync_events webhooks
 * 3. We match attendees against active pipeline contacts
 * 4. If match + auto-join enabled → schedule a bot via Recall's Calendar Event API
 *
 * Edge cases handled:
 * - Meeting time changes → update bot schedule
 * - Meeting cancelled → cancel bot
 * - Bot can't join → create request_info on lead card
 * - Calendar disconnected → notify user
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  listCalendarEvents,
  scheduleBotForCalendarEvent,
  deleteRecallBot,
  type CalendarEvent,
} from "@/lib/recall/client";
import { dispatchNotification } from "@/lib/skyler/notifications";

// ── Handle calendar sync events (called from webhook) ───────────────────────

/**
 * Process a calendar.sync_events webhook from Recall.
 * Fetches updated events, matches against pipeline, schedules/cancels bots.
 */
export async function handleCalendarSyncEvent(
  recallCalendarId: string
): Promise<{ scheduled: number; cancelled: number }> {
  const db = createAdminSupabaseClient();

  // Look up our calendar record
  const { data: calendar } = await db
    .from("recall_calendars")
    .select("id, workspace_id, auto_join_external")
    .eq("recall_calendar_id", recallCalendarId)
    .eq("status", "connected")
    .maybeSingle();

  if (!calendar) {
    console.warn(`[calendar-sync] No connected calendar found for Recall ID ${recallCalendarId}`);
    return { scheduled: 0, cancelled: 0 };
  }

  if (!calendar.auto_join_external) {
    console.log(`[calendar-sync] Auto-join disabled for workspace ${calendar.workspace_id}`);
    return { scheduled: 0, cancelled: 0 };
  }

  const workspaceId = calendar.workspace_id as string;

  // Fetch upcoming events from Recall (next 7 days)
  const now = new Date();
  const future7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = await listCalendarEvents(recallCalendarId, {
    startTime: now.toISOString(),
    endTime: future7d.toISOString(),
  });

  if (events.length === 0) return { scheduled: 0, cancelled: 0 };

  // Get active pipeline contact emails for matching
  const { data: pipelines } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email")
    .eq("workspace_id", workspaceId)
    .is("resolution", null)
    .limit(200);

  if (!pipelines || pipelines.length === 0) return { scheduled: 0, cancelled: 0 };

  const contactMap = new Map<string, string>();
  for (const p of pipelines) {
    contactMap.set((p.contact_email as string).toLowerCase(), p.id as string);
  }

  // Get existing bot records to avoid duplicates
  const { data: existingBots } = await db
    .from("recall_bots")
    .select("calendar_event_id, recall_bot_id, status")
    .eq("workspace_id", workspaceId)
    .in("status", ["scheduled", "joining", "in_call"]);

  const existingEventIds = new Set(
    (existingBots ?? []).map((b) => b.calendar_event_id).filter(Boolean)
  );

  // Get workspace name for bot display name
  const { data: workspace } = await db
    .from("workspaces")
    .select("name, settings")
    .eq("id", workspaceId)
    .single();

  const wsSettings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const meetingSettings = (wsSettings.skyler_meeting ?? {}) as Record<string, unknown>;
  const botDisplayName = (meetingSettings.botDisplayName as string) || `Skyler - ${workspace?.name ?? "Notetaker"}`;

  let scheduled = 0;
  let cancelled = 0;

  for (const event of events) {
    // Handle cancelled events
    if (event.is_deleted) {
      if (existingEventIds.has(event.id)) {
        await cancelBotForEvent(db, event.id, workspaceId);
        cancelled++;
      }
      continue;
    }

    // Skip if bot already exists for this event
    if (existingEventIds.has(event.id)) continue;

    // Check if any attendee is a pipeline contact
    const attendeeEmails = (event.attendees ?? []).map((a) => a.email.toLowerCase());
    const externalAttendees = attendeeEmails.filter((email) => contactMap.has(email));

    if (externalAttendees.length === 0) continue;

    // Found a match — schedule a bot
    const leadId = contactMap.get(externalAttendees[0])!;
    const dedupKey = `${event.start_time}-${event.meeting_url ?? event.id}`;

    try {
      const bot = await scheduleBotForCalendarEvent({
        calendarEventId: event.id,
        botName: botDisplayName,
        dedupKey,
        metadata: { workspace_id: workspaceId, lead_id: leadId },
      });

      // Store in recall_bots table
      await db.from("recall_bots").insert({
        recall_bot_id: bot.id,
        workspace_id: workspaceId,
        lead_id: leadId,
        calendar_event_id: event.id,
        meeting_url: event.meeting_url,
        scheduled_join_at: event.start_time,
        status: "scheduled",
        bot_name: botDisplayName,
      });

      // Also store on pipeline record for backward compat
      await db
        .from("skyler_sales_pipeline")
        .update({ recall_bot_id: bot.id, updated_at: new Date().toISOString() })
        .eq("id", leadId);

      console.log(
        `[calendar-sync] Bot ${bot.id} scheduled for event "${event.title}" (lead ${leadId})`
      );
      scheduled++;
    } catch (err) {
      console.error(
        `[calendar-sync] Failed to schedule bot for event ${event.id}:`,
        err instanceof Error ? err.message : err
      );

      // Graceful degradation: ask user for meeting notes
      await db
        .from("skyler_requests")
        .insert({
          workspace_id: workspaceId,
          pipeline_id: leadId,
          request_description: `I couldn't join the meeting "${event.title ?? "Upcoming meeting"}" with this lead. Could you share what was discussed so I can follow up properly?`,
          status: "pending",
        });
    }
  }

  console.log(
    `[calendar-sync] Processed ${events.length} events: ${scheduled} bots scheduled, ${cancelled} cancelled`
  );
  return { scheduled, cancelled };
}

// ── Handle calendar disconnection ───────────────────────────────────────────

/**
 * Handle calendar.update webhook — typically a disconnection.
 */
export async function handleCalendarUpdate(
  recallCalendarId: string,
  status: string
): Promise<void> {
  const db = createAdminSupabaseClient();

  if (status === "disconnected" || status === "error") {
    // Mark calendar as disconnected
    const { data: calendar } = await db
      .from("recall_calendars")
      .update({ status: "disconnected", updated_at: new Date().toISOString() })
      .eq("recall_calendar_id", recallCalendarId)
      .select("workspace_id")
      .maybeSingle();

    if (calendar) {
      await dispatchNotification(db, {
        workspaceId: calendar.workspace_id as string,
        eventType: "escalation_triggered",
        pipelineId: undefined as unknown as string,
        title: "Calendar disconnected",
        body: "Your calendar has been disconnected from Skyler. Reconnect it in Workflow Settings to continue auto-recording meetings.",
        metadata: { recallCalendarId },
      });
      console.log(`[calendar-sync] Calendar ${recallCalendarId} disconnected`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function cancelBotForEvent(
  db: ReturnType<typeof createAdminSupabaseClient>,
  calendarEventId: string,
  workspaceId: string
): Promise<void> {
  const { data: bot } = await db
    .from("recall_bots")
    .select("recall_bot_id")
    .eq("calendar_event_id", calendarEventId)
    .eq("workspace_id", workspaceId)
    .in("status", ["scheduled", "joining"])
    .maybeSingle();

  if (bot) {
    await deleteRecallBot(bot.recall_bot_id as string);
    await db
      .from("recall_bots")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("recall_bot_id", bot.recall_bot_id);
    console.log(`[calendar-sync] Cancelled bot for deleted event ${calendarEventId}`);
  }
}

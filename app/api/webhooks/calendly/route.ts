/**
 * Calendly Webhook Handler — processes booking, cancellation, and reschedule events.
 * Normalises into calendar_events and triggers Inngest flows.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";
import { getScheduledEvent, getEventInvitees } from "@/lib/skyler/calendar/calendly-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event: eventType, payload } = body as {
      event: string;
      payload: Record<string, unknown>;
    };

    console.log(`[calendly-webhook] Received: ${eventType}`);

    const db = createAdminSupabaseClient();

    if (eventType === "invitee.created") {
      await handleInviteeCreated(db, payload);
    } else if (eventType === "invitee.canceled") {
      await handleInviteeCanceled(db, payload);
    } else if (eventType === "routing_form_submission.created") {
      // Log for enrichment — minimal handling for now
      console.log("[calendly-webhook] Routing form submission:", JSON.stringify(payload).slice(0, 500));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendly-webhook] Error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

// ── invitee.created (meeting booked) ─────────────────────────────────────────

async function handleInviteeCreated(
  db: ReturnType<typeof createAdminSupabaseClient>,
  payload: Record<string, unknown>
) {
  const invitee = payload as {
    uri: string;
    email: string;
    name: string;
    timezone: string;
    scheduled_event: { uri: string };
    questions_and_answers: Array<{ question: string; answer: string }>;
    created_at: string;
  };

  const eventUri = invitee.scheduled_event?.uri;
  if (!eventUri) return;

  // Find the workspace by checking calendar_connections for calendly
  const { data: connections } = await db
    .from("calendar_connections")
    .select("workspace_id, id")
    .eq("provider", "calendly")
    .eq("oauth_status", "connected");

  if (!connections?.length) {
    console.warn("[calendly-webhook] No connected Calendly workspaces found");
    return;
  }

  // For now use the first connected workspace — multi-tenant routing can be added later
  const connection = connections[0];
  const workspaceId = connection.workspace_id;

  // Fetch full event details (webhook payload doesn't include meeting URL)
  let scheduledEvent;
  try {
    scheduledEvent = await getScheduledEvent(
      { workspaceId, connectionId: workspaceId },
      eventUri
    );
  } catch (err) {
    console.error("[calendly-webhook] Failed to fetch scheduled event:", err);
    return;
  }

  const meetingUrl = scheduledEvent.location?.join_url ?? null;
  const eventUuid = eventUri.split("/").pop()!;

  // Match invitee email against pipeline
  const { data: pipelineMatch } = await db
    .from("skyler_sales_pipeline")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("contact_email", invitee.email)
    .is("resolution", null)
    .limit(1)
    .single();

  // Upsert calendar event
  const { data: calEvent } = await db
    .from("calendar_events")
    .upsert(
      {
        calendar_connection_id: connection.id,
        workspace_id: workspaceId,
        provider: "calendly",
        provider_event_id: eventUuid,
        title: scheduledEvent.name,
        start_time: scheduledEvent.start_time,
        end_time: scheduledEvent.end_time,
        meeting_url: meetingUrl,
        meeting_provider: meetingUrl?.includes("zoom")
          ? "zoom"
          : meetingUrl?.includes("meet.google")
          ? "google_meet"
          : meetingUrl?.includes("teams")
          ? "teams"
          : null,
        organizer_email: scheduledEvent.event_memberships?.[0]?.user_email,
        attendees: [
          {
            email: invitee.email,
            name: invitee.name,
            response_status: "accepted",
            role: "invitee",
          },
        ],
        status: "confirmed",
        lead_id: pipelineMatch?.id ?? null,
        calendly_invitee_uri: invitee.uri,
        form_answers: invitee.questions_and_answers ?? null,
        raw_data: payload,
      },
      { onConflict: "calendar_connection_id,provider_event_id" }
    )
    .select("id")
    .single();

  const calendarEventId = calEvent?.id;

  // Emit Inngest events
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];

  events.push({
    name: "skyler/meeting.booked",
    data: {
      workspaceId,
      calendarEventId,
      pipelineId: pipelineMatch?.id,
      provider: "calendly",
      meetingUrl,
      startTime: scheduledEvent.start_time,
      endTime: scheduledEvent.end_time,
      inviteeEmail: invitee.email,
      inviteeName: invitee.name,
    },
  });

  // Schedule no-show check 15 minutes after meeting END time
  const endTime = new Date(scheduledEvent.end_time);
  const noShowCheckAt = new Date(endTime.getTime() + 15 * 60 * 1000);

  events.push({
    name: "skyler/meeting.no-show-check",
    data: {
      workspaceId,
      calendarEventId,
      pipelineId: pipelineMatch?.id,
      provider: "calendly",
      inviteeUri: invitee.uri,
    },
    // Inngest scheduled send
    ts: noShowCheckAt.getTime(),
  } as { name: string; data: Record<string, unknown>; ts?: number });

  await inngest.send(events);

  console.log(
    `[calendly-webhook] Meeting booked: ${invitee.email} → pipeline ${pipelineMatch?.id ?? "no match"}`
  );
}

// ── invitee.canceled ─────────────────────────────────────────────────────────

async function handleInviteeCanceled(
  db: ReturnType<typeof createAdminSupabaseClient>,
  payload: Record<string, unknown>
) {
  const invitee = payload as {
    uri: string;
    email: string;
    name: string;
    scheduled_event: { uri: string };
    rescheduled: boolean;
    new_invitee?: string;
    cancellation?: {
      canceled_by: string;
      reason: string;
      canceler_type: "host" | "invitee";
    };
  };

  const eventUri = invitee.scheduled_event?.uri;
  if (!eventUri) return;
  const eventUuid = eventUri.split("/").pop()!;

  // Find the calendar event
  const { data: calEvent } = await db
    .from("calendar_events")
    .select("id, workspace_id, lead_id, reschedule_count")
    .eq("provider_event_id", eventUuid)
    .eq("provider", "calendly")
    .single();

  if (!calEvent) {
    console.warn("[calendly-webhook] No calendar event found for:", eventUuid);
    return;
  }

  if (invitee.rescheduled) {
    // This is a reschedule, NOT a true cancellation
    const newCount = (calEvent.reschedule_count ?? 0) + 1;

    await db
      .from("calendar_events")
      .update({
        reschedule_count: newCount,
        status: "cancelled", // old event is cancelled
        updated_at: new Date().toISOString(),
      })
      .eq("id", calEvent.id);

    // Create health signal if reschedule_count >= 2
    if (newCount >= 2) {
      await db.from("meeting_health_signals").insert({
        workspace_id: calEvent.workspace_id,
        lead_id: calEvent.lead_id,
        signal_type: "reschedule",
        severity: newCount >= 3 ? "critical" : "warning",
        event_id: calEvent.id,
        details: {
          reschedule_count: newCount,
          rescheduled_by: invitee.cancellation?.canceler_type,
        },
      });
    }

    await inngest.send({
      name: "skyler/meeting.rescheduled",
      data: {
        workspaceId: calEvent.workspace_id,
        calendarEventId: calEvent.id,
        pipelineId: calEvent.lead_id,
        rescheduleCount: newCount,
        newInviteeUri: invitee.new_invitee,
      },
    });

    console.log(`[calendly-webhook] Rescheduled (count: ${newCount}): ${invitee.email}`);
  } else {
    // True cancellation
    await db
      .from("calendar_events")
      .update({
        status: "cancelled",
        raw_data: payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", calEvent.id);

    await inngest.send({
      name: "skyler/meeting.cancelled",
      data: {
        workspaceId: calEvent.workspace_id,
        calendarEventId: calEvent.id,
        pipelineId: calEvent.lead_id,
        canceledBy: invitee.cancellation?.canceler_type,
        reason: invitee.cancellation?.reason,
        inviteeEmail: invitee.email,
      },
    });

    console.log(`[calendly-webhook] Cancelled by ${invitee.cancellation?.canceler_type}: ${invitee.email}`);
  }
}

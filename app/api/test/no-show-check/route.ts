/**
 * Test route: Manually trigger no-show detection for the most recent calendar event.
 * GET /api/test/no-show-check
 *
 * Finds the latest calendar_events row with a lead_id and fires the
 * skyler/meeting.no-show-check Inngest event immediately (no delay).
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();

    // Find the most recent calendar event with a lead
    const { data: calEvent, error: findErr } = await db
      .from("calendar_events")
      .select("id, title, start_time, end_time, lead_id, status, no_show_detected, provider, attendees")
      .eq("workspace_id", WORKSPACE_ID)
      .not("lead_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!calEvent) {
      return NextResponse.json({
        error: "No calendar events with a lead_id found",
        detail: findErr?.message,
      }, { status: 404 });
    }

    steps.calendarEvent = {
      id: calEvent.id,
      title: calEvent.title,
      start_time: calEvent.start_time,
      end_time: calEvent.end_time,
      lead_id: calEvent.lead_id,
      status: calEvent.status,
      no_show_detected: calEvent.no_show_detected,
      provider: calEvent.provider,
    };

    // Load the pipeline record for context
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, company_name, contact_email")
      .eq("id", calEvent.lead_id)
      .single();

    steps.pipeline = pipeline ?? "Not found";

    // Check meeting timing
    const endTime = new Date(calEvent.end_time);
    const minutesSinceEnd = Math.round((Date.now() - endTime.getTime()) / 60000);
    steps.timing = {
      endTime: calEvent.end_time,
      minutesSinceEnd,
      meetingHasEnded: minutesSinceEnd > 0,
    };

    // Reset no_show_detected flag so we can re-test
    if (calEvent.no_show_detected) {
      await db
        .from("calendar_events")
        .update({ no_show_detected: false, updated_at: new Date().toISOString() })
        .eq("id", calEvent.id);
      steps.resetNoShowFlag = true;
    }

    // Fire the Inngest event immediately (no ts delay)
    const sendResult = await inngest.send({
      name: "skyler/meeting.no-show-check",
      data: {
        workspaceId: WORKSPACE_ID,
        calendarEventId: calEvent.id,
        pipelineId: calEvent.lead_id,
        provider: calEvent.provider ?? "microsoft_outlook",
      },
    });

    steps.inngestEvent = { status: "sent", result: sendResult };

    return NextResponse.json({
      status: "ok",
      summary: {
        eventTitle: calEvent.title,
        leadName: pipeline?.contact_name ?? "Unknown",
        company: pipeline?.company_name ?? "Unknown",
        meetingEndedMinutesAgo: minutesSinceEnd,
        inngestTriggered: true,
      },
      steps,
      nextSteps: "No-show detection should run within ~10 seconds. Check Slack and email for the notification.",
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({
      steps,
      error: e.message,
      stack: e.stack?.split("\n").slice(0, 5),
    }, { status: 500 });
  }
}

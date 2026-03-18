/**
 * Test route: Create a calendar event 35 min from now and trigger pre-call brief.
 * GET /api/test/pre-call-brief
 *
 * Steps:
 * 1. Find Malik's pipeline record (prominessltd@gmail.com)
 * 2. Create Outlook event with Malik as attendee (35 min from now)
 * 3. Insert calendar_events row in Supabase
 * 4. Fire Inngest event to trigger generate-pre-call-brief
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";
const LEAD_EMAIL = "prominessltd@gmail.com";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // ── Step 1: Find Malik's pipeline record ────────────────────────────
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, contact_email, company_name, stage, lead_score, deal_value")
      .ilike("contact_email", LEAD_EMAIL)
      .is("resolution", null)
      .maybeSingle();

    steps.pipelineRecord = pipeline ?? "Not found — brief will generate without lead context";

    // ── Step 2: Get Outlook integration ─────────────────────────────────
    const { data: integration } = await db
      .from("integrations")
      .select("nango_connection_id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "outlook")
      .eq("status", "connected")
      .single();

    if (!integration?.nango_connection_id) {
      return NextResponse.json({ steps, error: "No connected Outlook integration" }, { status: 404 });
    }

    const connectionId = integration.nango_connection_id;

    // ── Step 3: Get user timezone ───────────────────────────────────────
    let timeZone = "UTC";
    try {
      const tzResp = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me/mailboxSettings",
        providerConfigKey: "outlook",
        connectionId,
      });
      const settings = tzResp.data as Record<string, unknown>;
      timeZone = (settings.timeZone as string) ?? "UTC";
    } catch {
      // fallback to UTC
    }

    // ── Step 4: Create Outlook event 35 min from now ────────────────────
    const startTime = new Date(Date.now() + 35 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    // Format as local datetime strings (without Z) for Graph API
    const pad = (n: number) => String(n).padStart(2, "0");
    const formatLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

    const startStr = formatLocal(startTime);
    const endStr = formatLocal(endTime);

    const leadName = pipeline?.contact_name ?? "Malik";

    const eventResp = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com/v1.0",
      endpoint: "/me/events",
      providerConfigKey: "outlook",
      connectionId,
      data: {
        subject: `Demo Call with ${leadName} - Pre-Call Brief Test`,
        body: {
          contentType: "HTML",
          content: `<p>Test meeting to verify pre-call brief generation. Created by Skyler test route.</p>`,
        },
        start: { dateTime: startStr, timeZone },
        end: { dateTime: endStr, timeZone },
        attendees: [
          {
            emailAddress: { address: LEAD_EMAIL, name: leadName },
            type: "required",
          },
        ],
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      },
    });

    const outlookEvent = eventResp.data as Record<string, unknown>;
    const onlineMeeting = outlookEvent.onlineMeeting as Record<string, unknown> | null;
    const outlookEventId = outlookEvent.id as string;

    steps.outlookEvent = {
      id: outlookEventId,
      subject: outlookEvent.subject,
      start: outlookEvent.start,
      end: outlookEvent.end,
      teamsJoinUrl: onlineMeeting?.joinUrl ?? null,
    };

    // ── Step 5: Get organizer email ─────────────────────────────────────
    let organizerEmail = "";
    try {
      const meResp = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me",
        providerConfigKey: "outlook",
        connectionId,
      });
      const me = meResp.data as Record<string, unknown>;
      organizerEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? "";
    } catch {
      // non-critical
    }

    // ── Step 6: Insert calendar_events row ──────────────────────────────
    const { data: calEvent, error: insertErr } = await db
      .from("calendar_events")
      .insert({
        workspace_id: WORKSPACE_ID,
        provider: "microsoft_outlook",
        provider_event_id: outlookEventId,
        title: `Demo Call with ${leadName} - Pre-Call Brief Test`,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        timezone: timeZone,
        meeting_url: (onlineMeeting?.joinUrl as string) ?? null,
        meeting_provider: "teams",
        organizer_email: organizerEmail,
        attendees: [{ email: LEAD_EMAIL, name: leadName }],
        status: "confirmed",
        event_type: "demo",
        lead_id: pipeline?.id ?? null,
        pre_call_brief_sent: false,
      })
      .select("id")
      .single();

    if (insertErr || !calEvent) {
      steps.calendarEventInsert = { error: insertErr?.message };
      return NextResponse.json({ steps, error: "Failed to insert calendar_events row" }, { status: 500 });
    }

    steps.calendarEventRow = { id: calEvent.id, status: "inserted" };

    // ── Step 7: Fire Inngest event ──────────────────────────────────────
    const sendResult = await inngest.send({
      name: "skyler/meeting.pre-call-brief",
      data: {
        workspaceId: WORKSPACE_ID,
        calendarEventId: calEvent.id,
        pipelineId: pipeline?.id ?? undefined,
      },
    });

    steps.inngestEvent = { status: "sent", result: sendResult };

    return NextResponse.json({
      status: "ok",
      summary: {
        outlookEventCreated: true,
        calendarEventsRowId: calEvent.id,
        pipelineId: pipeline?.id ?? null,
        leadName,
        meetingTime: startTime.toISOString(),
        teamsLink: (onlineMeeting?.joinUrl as string) ?? null,
        inngestTriggered: true,
      },
      steps,
      nextSteps: "Pre-call brief should arrive via Slack and email within ~30 seconds. Check both channels.",
    });
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string; stack?: string };
    return NextResponse.json({
      steps,
      error: e.message,
      statusCode: e.response?.status,
      responseBody: JSON.stringify(e.response?.data ?? "").slice(0, 1000),
      stack: e.stack?.split("\n").slice(0, 5),
    }, { status: 500 });
  }
}

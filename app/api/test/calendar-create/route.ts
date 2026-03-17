/**
 * Test route: Create an Outlook calendar event with a Teams meeting link.
 * GET /api/test/calendar-create
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  try {
    const db = createAdminSupabaseClient();
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // Get Nango connection ID
    const { data: integration } = await db
      .from("integrations")
      .select("nango_connection_id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "outlook")
      .eq("status", "connected")
      .single();

    if (!integration?.nango_connection_id) {
      return NextResponse.json({ error: "No connected Outlook integration" }, { status: 404 });
    }

    const connectionId = integration.nango_connection_id;

    // Get user's timezone via /me/mailboxSettings
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

    // Tomorrow at 10:00 AM in the user's timezone
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD
    const startDateTime = `${dateStr}T10:00:00`;
    const endDateTime = `${dateStr}T10:30:00`;

    // Create event with Teams link
    const resp = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com/v1.0",
      endpoint: "/me/events",
      providerConfigKey: "outlook",
      connectionId,
      data: {
        subject: "Test Meeting - Skyler",
        body: {
          contentType: "HTML",
          content: "<p>This is a test meeting created by Skyler to verify Teams link generation.</p>",
        },
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone },
        attendees: [
          {
            emailAddress: { address: "test@example.com", name: "Test Attendee" },
            type: "required",
          },
        ],
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      },
    });

    const event = resp.data as Record<string, unknown>;
    const onlineMeeting = event.onlineMeeting as Record<string, unknown> | null;

    return NextResponse.json({
      status: "ok",
      event: {
        id: event.id,
        subject: event.subject,
        start: event.start,
        end: event.end,
        webLink: event.webLink,
        teamsJoinUrl: onlineMeeting?.joinUrl ?? null,
        isOnlineMeeting: event.isOnlineMeeting,
        onlineMeetingProvider: event.onlineMeetingProvider,
      },
      timeZoneUsed: timeZone,
    });
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    return NextResponse.json({
      error: e.message,
      statusCode: e.response?.status,
      responseBody: JSON.stringify(e.response?.data ?? "").slice(0, 1000),
    }, { status: 500 });
  }
}

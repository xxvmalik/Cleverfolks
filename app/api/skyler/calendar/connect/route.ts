/**
 * POST /api/skyler/calendar/connect
 *
 * After a user connects Google Calendar or Outlook via Nango, this endpoint
 * extracts the OAuth refresh token and sends it to Recall AI Calendar V2.
 *
 * Called from the Workflow Settings calendar connection buttons.
 * The Integrations page uses connectIntegrationAction which calls
 * wireCalendarToRecall directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createRecallCalendar } from "@/lib/recall/client";

const NANGO_API_URL = "https://api.nango.dev";

const PROVIDER_MAP: Record<string, {
  recallPlatform: "google_calendar" | "microsoft_outlook";
  dbProvider: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}> = {
  "google-calendar": {
    recallPlatform: "google_calendar",
    dbProvider: "google",
    clientIdEnv: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  outlook: {
    recallPlatform: "microsoft_outlook",
    dbProvider: "outlook",
    clientIdEnv: "OUTLOOK_CLIENT_ID",
    clientSecretEnv: "OUTLOOK_CLIENT_SECRET",
  },
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { workspaceId, provider } = body as { workspaceId: string; provider: string };

  if (!workspaceId || !provider) {
    return NextResponse.json({ error: "workspaceId and provider required" }, { status: 400 });
  }

  const config = PROVIDER_MAP[provider];
  if (!config) {
    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  // Verify workspace membership
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createAdminSupabaseClient();

  try {
    // Get Nango connection ID
    const { data: integration } = await db
      .from("integrations")
      .select("nango_connection_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      .eq("status", "connected")
      .single();

    if (!integration?.nango_connection_id) {
      return NextResponse.json(
        { error: `${provider} not connected. Connect it on the Integrations page first.` },
        { status: 400 }
      );
    }

    // Check if already wired to Recall
    const { data: existing } = await db
      .from("recall_calendars")
      .select("id, recall_calendar_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", config.dbProvider)
      .single();

    if (existing) {
      return NextResponse.json({
        ok: true,
        recallCalendarId: existing.recall_calendar_id,
        message: "Already connected to Recall",
      });
    }

    // Fetch refresh token from Nango
    const nangoRes = await fetch(
      `${NANGO_API_URL}/connection/${encodeURIComponent(integration.nango_connection_id)}?provider_config_key=${encodeURIComponent(provider)}`,
      { headers: { Authorization: `Bearer ${process.env.NANGO_SECRET_KEY}` } }
    );

    if (!nangoRes.ok) {
      return NextResponse.json({ error: "Failed to fetch connection from Nango" }, { status: 502 });
    }

    const nangoConnection = await nangoRes.json();
    const refreshToken = nangoConnection.credentials?.refresh_token;

    if (!refreshToken) {
      return NextResponse.json({ error: "No refresh token. Please reconnect the calendar." }, { status: 400 });
    }

    const clientId = process.env[config.clientIdEnv];
    const clientSecret = process.env[config.clientSecretEnv];

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: "Calendar OAuth not configured on server" }, { status: 500 });
    }

    // Create in Recall AI
    const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`
      : undefined;

    const recallCalendar = await createRecallCalendar({
      platform: config.recallPlatform,
      oauthRefreshToken: refreshToken,
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      webhookUrl,
    });

    // Store in DB
    await db.from("recall_calendars").insert({
      workspace_id: workspaceId,
      recall_calendar_id: recallCalendar.id,
      provider: config.dbProvider,
      platform_email: recallCalendar.platform_email ?? null,
      status: "connected",
    });

    // Update workspace meeting settings
    const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
    const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;
    const currentMeeting = (currentSettings.skyler_meeting ?? {}) as Record<string, unknown>;

    await db
      .from("workspaces")
      .update({
        settings: {
          ...currentSettings,
          skyler_meeting: {
            ...currentMeeting,
            calendarConnected: true,
            calendarProvider: config.dbProvider,
            calendarEmail: recallCalendar.platform_email ?? "",
          },
        },
      })
      .eq("id", workspaceId);

    return NextResponse.json({
      ok: true,
      recallCalendarId: recallCalendar.id,
      platformEmail: recallCalendar.platform_email,
    });
  } catch (err) {
    console.error("[calendar-connect] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect calendar" },
      { status: 500 }
    );
  }
}

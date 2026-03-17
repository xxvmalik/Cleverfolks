/**
 * GET /api/skyler/calendar/callback
 *
 * Google OAuth callback. Exchanges the authorization code for tokens,
 * stores the connection in the integrations table, and wires the refresh
 * token to Recall AI Calendar V2.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createRecallCalendar } from "@/lib/recall/client";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[calendar-callback] Google OAuth error:", error);
    return NextResponse.redirect(`${origin}/integrations?calendar_error=${encodeURIComponent(error)}`);
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${origin}/integrations?calendar_error=missing_code`);
  }

  // Decode state
  let workspaceId: string;
  try {
    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    workspaceId = state.workspaceId;
  } catch {
    return NextResponse.redirect(`${origin}/integrations?calendar_error=invalid_state`);
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
  const redirectUri = `${origin}/api/skyler/calendar/callback`;

  try {
    // Step 1: Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => "unknown");
      console.error("[calendar-callback] Token exchange failed:", tokenRes.status, errBody);
      return NextResponse.redirect(`${origin}/integrations?calendar_error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    const refreshToken = tokens.refresh_token;
    const accessToken = tokens.access_token;

    if (!refreshToken) {
      console.error("[calendar-callback] No refresh_token in response. Token keys:", Object.keys(tokens));
      return NextResponse.redirect(`${origin}/integrations?calendar_error=no_refresh_token`);
    }

    console.log("[calendar-callback] Got refresh token, exchanging with Recall...");

    // Step 2: Get user's email from Google
    let calendarEmail = "";
    try {
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json();
        calendarEmail = info.email ?? "";
      }
    } catch {
      // Non-critical
    }

    const db = createAdminSupabaseClient();

    // Step 3: Upsert integration record (mirrors connectIntegrationAction)
    const connectionId = `gcal-${workspaceId}`;
    const { data: existing } = await db
      .from("integrations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google-calendar")
      .single();

    if (existing) {
      await db
        .from("integrations")
        .update({
          status: "connected",
          nango_connection_id: connectionId,
          sync_status: "idle",
          sync_error: null,
        })
        .eq("id", existing.id);
    } else {
      await db.from("integrations").insert({
        workspace_id: workspaceId,
        provider: "google-calendar",
        status: "connected",
        nango_connection_id: connectionId,
        sync_status: "idle",
      });
    }

    // Step 4: Check if Recall calendar already exists
    const { data: existingRecall } = await db
      .from("recall_calendars")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google")
      .single();

    if (!existingRecall) {
      // Step 5: Create calendar in Recall AI
      const webhookUrl = origin ? `${origin}/api/recall/webhook` : undefined;

      const recallCalendar = await createRecallCalendar({
        platform: "google_calendar",
        oauthRefreshToken: refreshToken,
        oauthClientId: clientId,
        oauthClientSecret: clientSecret,
        webhookUrl,
      });

      console.log(`[calendar-callback] Recall calendar created: ${recallCalendar.id}`);

      await db.from("recall_calendars").insert({
        workspace_id: workspaceId,
        recall_calendar_id: recallCalendar.id,
        provider: "google",
        platform_email: recallCalendar.platform_email ?? calendarEmail,
        status: "connected",
      });

      calendarEmail = recallCalendar.platform_email ?? calendarEmail;
    }

    // Step 6: Update workspace meeting settings
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
            calendarProvider: "google",
            calendarEmail,
          },
        },
      })
      .eq("id", workspaceId);

    console.log(`[calendar-callback] Google Calendar connected for workspace ${workspaceId}`);
    return NextResponse.redirect(`${origin}/integrations?calendar_connected=true`);
  } catch (err) {
    console.error("[calendar-callback] Error:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${origin}/integrations?calendar_error=internal`);
  }
}

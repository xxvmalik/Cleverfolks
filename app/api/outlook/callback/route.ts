/**
 * GET /api/outlook/callback
 *
 * Handles the Microsoft OAuth callback after force-consent.
 * Exchanges the code for tokens and updates the Nango connection
 * so the integration uses the new token with full scopes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    console.error(`[outlook-callback] OAuth error: ${error} — ${req.nextUrl.searchParams.get("error_description")}`);
    return NextResponse.redirect(new URL("/connectors?error=outlook_denied", req.url));
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(new URL("/connectors?error=missing_code", req.url));
  }

  let workspaceId: string;
  try {
    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString()) as { workspaceId: string };
    workspaceId = state.workspaceId;
  } catch {
    return NextResponse.redirect(new URL("/connectors?error=bad_state", req.url));
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID!;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET!;
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const redirectUri = `${origin}/api/outlook/callback`;

  // Exchange code for tokens
  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[outlook-callback] Token exchange failed: ${tokenRes.status}`, errBody);
      return NextResponse.redirect(new URL("/connectors?error=token_failed", req.url));
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    console.error(`[outlook-callback] Token exchange success. Scopes granted: ${tokens.scope}`);

    // Update the Nango connection with the new tokens via Nango API
    const nangoSecret = process.env.NANGO_SECRET_KEY;
    if (nangoSecret && tokens.refresh_token) {
      // Find the existing Nango connection ID for this workspace's Outlook
      const adminDb = createAdminSupabaseClient();
      const { data: integration } = await adminDb
        .from("integrations")
        .select("nango_connection_id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "outlook")
        .single();

      const connectionId = integration?.nango_connection_id;

      if (connectionId) {
        // Update the existing Nango connection's credentials
        const updateRes = await fetch(
          `https://api.nango.dev/connection/${encodeURIComponent(connectionId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${nangoSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              provider_config_key: "outlook",
              credentials: {
                type: "OAUTH2",
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              },
            }),
          }
        );

        if (updateRes.ok) {
          console.error(`[outlook-callback] Updated Nango connection ${connectionId} with new tokens`);
        } else {
          const errText = await updateRes.text();
          console.error(`[outlook-callback] Failed to update Nango connection: ${updateRes.status}`, errText);
        }
      }

      // Ensure DB is up to date
      await adminDb
        .from("integrations")
        .update({ status: "connected" })
        .eq("workspace_id", workspaceId)
        .eq("provider", "outlook");
    }

    return NextResponse.redirect(new URL("/connectors?outlook=connected", req.url));
  } catch (err) {
    console.error("[outlook-callback] Error:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/connectors?error=outlook_error", req.url));
  }
}

/**
 * GET /api/outlook/authorize?workspaceId=...
 *
 * Redirects to Microsoft OAuth with prompt=consent to force re-consent
 * for all scopes (Mail.Send, Mail.ReadWrite, etc.).
 * Bypasses Nango ConnectUI which can't force consent.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "OUTLOOK_CLIENT_ID not configured" }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const redirectUri = `${origin}/api/outlook/callback`;

  const state = Buffer.from(JSON.stringify({ workspaceId })).toString("base64url");

  const scopes = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Send.Shared",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Calendars.Read",
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "https://graph.microsoft.com/Contacts.Read",
    "https://graph.microsoft.com/MailboxSettings.Read",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`${MS_AUTH_URL}?${params.toString()}`);
}

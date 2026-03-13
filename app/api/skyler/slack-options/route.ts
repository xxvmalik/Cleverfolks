/**
 * GET /api/skyler/slack-options?workspaceId=<id>
 *
 * Fetches available Slack channels and members from the connected Slack workspace.
 * Uses Nango proxy to call Slack API (conversations.list + users.list).
 */

import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type SlackOption = {
  id: string;
  name: string;
  type: "channel" | "member";
};

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Find the Slack Nango connection for this workspace
  const { data: integration } = await db
    .from("integrations")
    .select("nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();

  if (!integration?.nango_connection_id) {
    return NextResponse.json({ error: "Slack not connected", channels: [], members: [] });
  }

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const connectionId = integration.nango_connection_id;
  const channels: SlackOption[] = [];
  const members: SlackOption[] = [];

  // Fetch channels
  try {
    const channelRes = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://slack.com",
      endpoint: "/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200",
      connectionId,
      providerConfigKey: "slack",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channelData = (channelRes as any)?.data;
    if (channelData?.ok && channelData.channels) {
      for (const ch of channelData.channels) {
        channels.push({
          id: ch.id,
          name: `#${ch.name}`,
          type: "channel",
        });
      }
    }
  } catch (err) {
    console.error("[slack-options] Failed to fetch channels:", err instanceof Error ? err.message : err);
  }

  // Fetch members
  try {
    const memberRes = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://slack.com",
      endpoint: "/api/users.list?limit=200",
      connectionId,
      providerConfigKey: "slack",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memberData = (memberRes as any)?.data;
    if (memberData?.ok && memberData.members) {
      for (const m of memberData.members) {
        // Skip bots, deactivated users, and slackbot
        if (m.is_bot || m.deleted || m.id === "USLACKBOT") continue;
        const displayName = m.profile?.display_name || m.profile?.real_name || m.name;
        if (displayName) {
          members.push({
            id: m.id,
            name: `@${displayName}`,
            type: "member",
          });
        }
      }
    }
  } catch (err) {
    console.error("[slack-options] Failed to fetch members:", err instanceof Error ? err.message : err);
  }

  // Sort alphabetically
  channels.sort((a, b) => a.name.localeCompare(b.name));
  members.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ channels, members });
}

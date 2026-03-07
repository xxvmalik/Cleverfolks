import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const PROVIDER_LOGOS: Record<string, string> = {
  hubspot: "/integration-logos/hubspot.svg",
  slack: "/integration-logos/slack.svg",
  "google-mail": "/integration-logos/gmail.svg",
  outlook: "/integration-logos/outlook.svg",
  "google-calendar": "/integration-logos/google-calendar.svg",
  "google-drive": "/integration-logos/google-drive.svg",
};

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected");

  const logos = (integrations ?? [])
    .filter((i: { provider: string }) => PROVIDER_LOGOS[i.provider])
    .map((i: { provider: string }) => ({
      provider: i.provider,
      logoUrl: PROVIDER_LOGOS[i.provider],
    }));

  return NextResponse.json({ logos, allLogos: PROVIDER_LOGOS });
}

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { data } = await db
    .from("agent_configurations")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "skyler")
    .maybeSingle();

  return NextResponse.json({ config: data?.config ?? null });
}

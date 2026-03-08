import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve workspace: optional query param, otherwise from user's membership
  let workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    const { data: membership } = await supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    workspaceId = membership?.workspace_id ?? null;
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const adminDb = createAdminSupabaseClient();

  // Count by classification
  const [hotRes, nurtureRes, disqualifiedRes, totalRes] = await Promise.all([
    adminDb
      .from("lead_scores")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("classification", "hot"),
    adminDb
      .from("lead_scores")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("classification", "nurture"),
    adminDb
      .from("lead_scores")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("classification", "disqualified"),
    adminDb
      .from("lead_scores")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .neq("classification", "unscored"),
  ]);

  const hot = hotRes.count ?? 0;
  const nurture = nurtureRes.count ?? 0;
  const disqualified = disqualifiedRes.count ?? 0;
  const total = totalRes.count ?? 0;
  const qualificationRate = total > 0 ? Math.round(((hot + nurture) / total) * 100) : 0;

  return NextResponse.json({
    stats: {
      qualificationRate,
      hotLeads: hot,
      nurtureQueue: nurture,
      disqualified,
      totalScored: total,
    },
  });
}

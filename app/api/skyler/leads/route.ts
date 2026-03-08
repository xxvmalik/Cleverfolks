import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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

  const classification = req.nextUrl.searchParams.get("classification") ?? "all";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  const adminDb = createAdminSupabaseClient();

  let query = adminDb
    .from("lead_scores")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("classification", "unscored")
    .order("total_score", { ascending: false })
    .limit(limit);

  if (classification !== "all") {
    query = query.eq("classification", classification);
  }

  const { data: leads, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map to frontend-friendly format
  const mapped = (leads ?? []).map((l) => {
    const dims = (l.dimension_scores ?? {}) as Record<string, { score: number; reasoning: string }>;
    const priority: "High" | "Medium" | "Low" =
      l.classification === "hot" ? "High" : l.classification === "nurture" ? "Medium" : "Low";

    return {
      id: l.id,
      contact_id: l.contact_id,
      company: l.company_name ?? "Unknown Company",
      contact_name: l.contact_name ?? "Unknown",
      contact_email: l.contact_email,
      priority,
      potential: `Score: ${l.total_score}/100`,
      detail: l.contact_name ?? l.contact_email ?? "No details",
      total_score: l.total_score,
      classification: l.classification,
      dimension_scores: dims,
      is_referral: l.is_referral,
      referrer_name: l.referrer_name,
      referrer_company: l.referrer_company,
      scoring_reasoning: l.scoring_reasoning,
      scored_at: l.scored_at,
    };
  });

  return NextResponse.json({ leads: mapped });
}

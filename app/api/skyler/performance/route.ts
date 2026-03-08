/**
 * Performance metrics endpoint for Skyler Sales Closer.
 * Returns aggregated stats from skyler_sales_pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  if (!workspaceId) return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Aggregate from pipeline records
  const { data: records } = await db
    .from("skyler_sales_pipeline")
    .select("emails_sent, emails_opened, emails_clicked, emails_replied, resolution, stage")
    .eq("workspace_id", workspaceId);

  const all = records ?? [];
  const totalLeads = all.length;
  const totalEmailsSent = all.reduce((sum, r) => sum + (r.emails_sent ?? 0), 0);
  const totalOpened = all.reduce((sum, r) => sum + (r.emails_opened ?? 0), 0);
  const totalClicked = all.reduce((sum, r) => sum + (r.emails_clicked ?? 0), 0);
  const totalReplied = all.reduce((sum, r) => sum + (r.emails_replied ?? 0), 0);

  const meetingsBooked = all.filter((r) => r.resolution === "meeting_booked").length;
  const demosBooked = all.filter((r) => r.resolution === "demo_booked" || r.stage === "demo_booked").length;
  const paymentsSecured = all.filter((r) => r.resolution === "payment_secured").length;
  const dealsWon = all.filter((r) => r.stage === "closed_won").length;
  const dealsLost = all.filter((r) => r.stage === "disqualified").length;

  const openRate = totalEmailsSent > 0 ? Math.round((totalOpened / totalEmailsSent) * 100) : 0;
  const replyRate = totalEmailsSent > 0 ? Math.round((totalReplied / totalEmailsSent) * 100) : 0;
  const conversionRate = totalLeads > 0 ? Math.round((dealsWon / totalLeads) * 100) : 0;

  // Count by stage
  const stageBreakdown: Record<string, number> = {};
  for (const r of all) {
    stageBreakdown[r.stage] = (stageBreakdown[r.stage] ?? 0) + 1;
  }

  return NextResponse.json({
    metrics: {
      totalLeads,
      emailsSent: totalEmailsSent,
      emailsOpened: totalOpened,
      emailsClicked: totalClicked,
      emailsReplied: totalReplied,
      openRate,
      replyRate,
      meetingsBooked,
      demosBooked,
      paymentsSecured,
      dealsWon,
      dealsLost,
      conversionRate,
    },
    stageBreakdown,
  });
}

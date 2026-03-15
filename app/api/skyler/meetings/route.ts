/**
 * GET /api/skyler/meetings?lead_id={id}
 *
 * Returns all meetings for a lead with summaries and intelligence.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const leadId = req.nextUrl.searchParams.get("lead_id");
  if (!leadId) return NextResponse.json({ error: "lead_id required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  const { data: meetings, error } = await db
    .from("meeting_transcripts")
    .select("id, bot_id, meeting_date, meeting_url, summary, intelligence, participants, processing_status, duration_seconds, created_at")
    .eq("lead_id", leadId)
    .order("meeting_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ meetings: meetings ?? [] });
}

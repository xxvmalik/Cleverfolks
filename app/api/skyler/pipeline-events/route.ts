/**
 * GET /api/skyler/pipeline-events?pipelineId=X
 *
 * Returns pipeline events (stage changes, no-show detections, re-engagement touches, etc.)
 * for a specific lead. Used by the activity timeline in the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  const { data, error } = await db
    .from("pipeline_events")
    .select("id, event_type, from_stage, to_stage, source, source_detail, payload, created_at")
    .eq("lead_id", pipelineId)
    .order("created_at", { ascending: true })
    .limit(100);

  // Table may not exist yet — return empty array instead of 500
  if (error) {
    console.warn("[pipeline-events] Query error (table may not exist):", error.message);
    return NextResponse.json({ events: [] });
  }

  return NextResponse.json({ events: data ?? [] });
}

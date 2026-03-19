/**
 * GET /api/skyler/lead-meetings?pipelineId={id}
 *
 * Returns upcoming calendar events and past meeting transcripts for a lead.
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

  // Get the pipeline record to find contact_email for fallback matching
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, workspace_id")
    .eq("id", pipelineId)
    .single();

  if (!pipeline) return NextResponse.json({ error: "Pipeline record not found" }, { status: 404 });

  const now = new Date().toISOString();

  // Fetch upcoming calendar events — match by lead_id OR by attendee email
  const { data: linkedEvents } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, event_type, attendees, pre_call_brief_sent, status")
    .eq("lead_id", pipelineId)
    .gte("start_time", now)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });

  // Also check for events where lead_id isn't set but attendee email matches
  const { data: unmatchedEvents } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, event_type, attendees, pre_call_brief_sent, status")
    .eq("workspace_id", pipeline.workspace_id)
    .is("lead_id", null)
    .gte("start_time", now)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true })
    .limit(50);

  // Filter unmatched events by attendee email
  const contactEmail = pipeline.contact_email?.toLowerCase();
  const emailMatchedEvents = (unmatchedEvents ?? []).filter((event) => {
    const attendees = event.attendees as Array<{ email?: string }> | null;
    if (!attendees || !contactEmail) return false;
    return attendees.some((a) => a.email?.toLowerCase() === contactEmail);
  });

  // Merge and deduplicate by id
  const seenIds = new Set<string>();
  const upcoming = [...(linkedEvents ?? []), ...emailMatchedEvents].filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  // Backfill lead_id on any email-matched events (fire-and-forget)
  const idsToBackfill = emailMatchedEvents.map((e) => e.id);
  if (idsToBackfill.length > 0) {
    db.from("calendar_events")
      .update({ lead_id: pipelineId })
      .in("id", idsToBackfill)
      .then(() => {});
  }

  // Fetch past meetings from meeting_transcripts
  const { data: pastMeetings } = await db
    .from("meeting_transcripts")
    .select("id, bot_id, meeting_date, meeting_url, summary, intelligence, participants, processing_status, duration_seconds, created_at")
    .eq("lead_id", pipelineId)
    .order("meeting_date", { ascending: false });

  return NextResponse.json({
    upcoming: upcoming ?? [],
    past: pastMeetings ?? [],
  });
}

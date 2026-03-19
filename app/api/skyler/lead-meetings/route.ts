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

  // Get the pipeline record — includes meeting fields from old system as fallback
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, workspace_id, meeting_event_id, meeting_details, meeting_transcript, meeting_outcome, recall_bot_id")
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

  // Look up calendar event titles for past meetings (by lead_id, ordered by start_time desc to match)
  const { data: pastCalEvents } = await db
    .from("calendar_events")
    .select("id, title, start_time, recall_bot_id")
    .eq("lead_id", pipelineId)
    .order("start_time", { ascending: false });

  // Build a title lookup: match by recall_bot_id first, then by closest date
  const calEvents = pastCalEvents ?? [];
  function findMeetingTitle(meeting: { bot_id?: string | null; meeting_date?: string | null }): string | null {
    if (meeting.bot_id) {
      const byBot = calEvents.find((ce) => ce.recall_bot_id === meeting.bot_id);
      if (byBot) return byBot.title;
    }
    if (meeting.meeting_date && calEvents.length > 0) {
      const mDate = new Date(meeting.meeting_date).getTime();
      let closest = calEvents[0];
      let closestDiff = Math.abs(new Date(closest.start_time).getTime() - mDate);
      for (const ce of calEvents) {
        const diff = Math.abs(new Date(ce.start_time).getTime() - mDate);
        if (diff < closestDiff) { closest = ce; closestDiff = diff; }
      }
      // Only match if within 24 hours
      if (closestDiff < 86400000) return closest.title;
    }
    return null;
  }

  let past = (pastMeetings ?? []).map((m) => ({
    ...m,
    title: findMeetingTitle(m),
  }));

  // Fallback: if no meeting_transcripts rows exist but pipeline has meeting data
  // (old system stored transcripts directly on skyler_sales_pipeline fields)
  if (past.length === 0 && pipeline.meeting_event_id && pipeline.meeting_transcript) {
    const details = pipeline.meeting_details as { title?: string; start?: string; end?: string; link?: string } | null;
    const outcome = pipeline.meeting_outcome as { executive_summary?: string; outcome?: string; key_takeaways?: string[] } | null;

    // Build a summary from meeting_outcome if available
    let summary: string | null = null;
    if (outcome) {
      const parts: string[] = [];
      if (outcome.executive_summary) parts.push(outcome.executive_summary);
      if (outcome.key_takeaways?.length) parts.push("Key takeaways: " + outcome.key_takeaways.join("; "));
      summary = parts.join("\n\n") || null;
    }

    past = [{
      id: `pipeline-${pipelineId}`,
      bot_id: pipeline.recall_bot_id ?? null,
      title: details?.title ?? null,
      meeting_date: details?.start ?? pipeline.meeting_event_id,
      meeting_url: details?.link ?? null,
      summary,
      intelligence: outcome ?? null,
      participants: null,
      processing_status: outcome ? "complete" : "pending",
      duration_seconds: null,
      created_at: details?.start ?? new Date().toISOString(),
    }];
  }

  // Fallback: if no calendar_events rows but pipeline has meeting_details
  if (upcoming.length === 0 && pipeline.meeting_details) {
    const details = pipeline.meeting_details as { title?: string; start?: string; end?: string; link?: string } | null;
    if (details?.start) {
      const meetingStart = new Date(details.start);
      const nowDate = new Date();
      if (meetingStart > nowDate) {
        // Future meeting → show as upcoming
        upcoming.push({
          id: `pipeline-event-${pipelineId}`,
          title: details.title ?? "Meeting",
          start_time: details.start,
          end_time: details.end ?? details.start,
          meeting_url: details.link ?? null,
          event_type: null,
          attendees: [{ email: pipeline.contact_email }],
          pre_call_brief_sent: false,
          status: "confirmed",
        });
      }
    }
  }

  return NextResponse.json({
    upcoming,
    past,
  });
}

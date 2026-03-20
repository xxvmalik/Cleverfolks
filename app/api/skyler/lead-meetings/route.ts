/**
 * GET /api/skyler/lead-meetings?pipelineId={id}
 *
 * Returns upcoming and past calendar events for a lead.
 * Past meetings come from calendar_events where end_time < NOW().
 * Transcript data enriches past meetings but doesn't define their existence.
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

  // Get the pipeline record
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, workspace_id, meeting_details, recall_bot_id")
    .eq("id", pipelineId)
    .single();

  if (!pipeline) return NextResponse.json({ error: "Pipeline record not found" }, { status: 404 });

  const now = new Date().toISOString();
  const contactEmail = (pipeline.contact_email as string)?.toLowerCase();

  // ── Upcoming: calendar_events where start_time >= now ──────────────────

  const { data: linkedUpcoming } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, event_type, attendees, pre_call_brief_sent, status")
    .eq("lead_id", pipelineId)
    .gte("start_time", now)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });

  // Also check unlinked events where attendee email matches
  const { data: unmatchedUpcoming } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, event_type, attendees, pre_call_brief_sent, status")
    .eq("workspace_id", pipeline.workspace_id)
    .is("lead_id", null)
    .gte("start_time", now)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true })
    .limit(50);

  const emailMatchedUpcoming = (unmatchedUpcoming ?? []).filter((event) => {
    const attendees = event.attendees as Array<{ email?: string }> | null;
    if (!attendees || !contactEmail) return false;
    return attendees.some((a) => a.email?.toLowerCase() === contactEmail);
  });

  const seenIds = new Set<string>();
  const upcoming = [...(linkedUpcoming ?? []), ...emailMatchedUpcoming].filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  // Backfill lead_id on email-matched events (fire-and-forget)
  const idsToBackfill = emailMatchedUpcoming.map((e) => e.id);
  if (idsToBackfill.length > 0) {
    db.from("calendar_events")
      .update({ lead_id: pipelineId })
      .in("id", idsToBackfill)
      .then(() => {});
  }

  // ── Past: calendar_events where end_time < now ────────────────────────

  const { data: pastCalEvents } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, recall_bot_id, no_show_detected, meeting_outcome_reason, status, attendees")
    .eq("lead_id", pipelineId)
    .lt("end_time", now)
    .neq("status", "cancelled")
    .order("end_time", { ascending: false });

  // Also check unlinked past events by attendee email
  const { data: unmatchedPast } = await db
    .from("calendar_events")
    .select("id, title, start_time, end_time, meeting_url, recall_bot_id, no_show_detected, meeting_outcome_reason, status, attendees")
    .eq("workspace_id", pipeline.workspace_id)
    .is("lead_id", null)
    .lt("end_time", now)
    .neq("status", "cancelled")
    .order("end_time", { ascending: false })
    .limit(50);

  const emailMatchedPast = (unmatchedPast ?? []).filter((event) => {
    const attendees = event.attendees as Array<{ email?: string }> | null;
    if (!attendees || !contactEmail) return false;
    return attendees.some((a) => a.email?.toLowerCase() === contactEmail);
  });

  // Backfill lead_id on past email-matched events
  const pastIdsToBackfill = emailMatchedPast.map((e) => e.id);
  if (pastIdsToBackfill.length > 0) {
    db.from("calendar_events")
      .update({ lead_id: pipelineId })
      .in("id", pastIdsToBackfill)
      .then(() => {});
  }

  const pastSeenIds = new Set<string>();
  const allPastCalEvents = [...(pastCalEvents ?? []), ...emailMatchedPast].filter((e) => {
    if (pastSeenIds.has(e.id)) return false;
    pastSeenIds.add(e.id);
    return true;
  });

  // Load all meeting_transcripts for this lead (to enrich past meetings)
  const { data: transcripts } = await db
    .from("meeting_transcripts")
    .select("id, bot_id, meeting_date, meeting_url, summary, intelligence, participants, processing_status, duration_seconds")
    .eq("lead_id", pipelineId);

  // Build transcript lookup: match by recall_bot_id first, then by closest date
  const transcriptList = transcripts ?? [];

  function findTranscript(calEvent: { recall_bot_id: string | null; end_time: string; meeting_url: string | null; meeting_outcome_reason?: string | null }) {
    // Match by bot ID
    if (calEvent.recall_bot_id) {
      const byBot = transcriptList.find((t) => t.bot_id === calEvent.recall_bot_id);
      if (byBot) return byBot;
    }
    // Match by meeting URL
    if (calEvent.meeting_url) {
      const byUrl = transcriptList.find((t) => t.meeting_url === calEvent.meeting_url);
      if (byUrl) return byUrl;
    }
    // Match by closest date (within 24h)
    if (transcriptList.length > 0) {
      const calEnd = new Date(calEvent.end_time).getTime();
      let closest = transcriptList[0];
      let closestDiff = Math.abs(new Date(closest.meeting_date).getTime() - calEnd);
      for (const t of transcriptList) {
        const diff = Math.abs(new Date(t.meeting_date).getTime() - calEnd);
        if (diff < closestDiff) { closest = t; closestDiff = diff; }
      }
      if (closestDiff < 86400000) return closest;
    }
    return null;
  }

  // Build past meetings: calendar event is the source of truth, transcript enriches
  const past = allPastCalEvents.map((calEvent) => {
    const transcript = findTranscript(calEvent);
    const durationMin = Math.round(
      (new Date(calEvent.end_time).getTime() - new Date(calEvent.start_time).getTime()) / 60000
    );

    return {
      id: calEvent.id,
      title: calEvent.title ?? "Meeting",
      meeting_date: calEvent.start_time,
      start_time: calEvent.start_time,
      end_time: calEvent.end_time,
      meeting_url: calEvent.meeting_url,
      duration_seconds: transcript?.duration_seconds ?? durationMin * 60,
      no_show_detected: calEvent.no_show_detected ?? false,
      // Transcript enrichment (null if no transcript)
      transcript_id: transcript?.id ?? null,
      summary: transcript?.summary ?? null,
      intelligence: transcript?.intelligence ?? null,
      participants: transcript?.participants ?? null,
      processing_status: transcript?.processing_status ?? null,
      has_transcript: !!transcript,
      meeting_outcome_reason: calEvent.meeting_outcome_reason ?? null,
    };
  });

  // Fallback: if no calendar_events but pipeline has meeting_details (old system)
  if (upcoming.length === 0 && past.length === 0 && pipeline.meeting_details) {
    const details = pipeline.meeting_details as { title?: string; start?: string; end?: string; link?: string } | null;
    if (details?.start) {
      const meetingStart = new Date(details.start);
      const nowDate = new Date();
      if (meetingStart > nowDate) {
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

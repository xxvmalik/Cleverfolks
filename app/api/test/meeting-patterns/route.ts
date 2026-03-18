/**
 * Test route: Manually run meeting pattern detection.
 * GET /api/test/meeting-patterns
 *
 * Runs the same logic as the nightly cron (detect-meeting-patterns)
 * directly, without going through Inngest.
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  const steps: Record<string, unknown> = {};
  let signalsCreated = 0;

  try {
    const db = createAdminSupabaseClient();

    // ── Inventory: what data do we have? ──────────────────────────────
    const { data: allEvents, error: eventsErr } = await db
      .from("calendar_events")
      .select("id, title, lead_id, status, no_show_detected, reschedule_count, start_time, end_time")
      .eq("workspace_id", WORKSPACE_ID)
      .order("created_at", { ascending: false })
      .limit(50);

    steps.inventory = {
      totalEvents: allEvents?.length ?? 0,
      eventsError: eventsErr?.message ?? null,
      withLeadId: allEvents?.filter((e) => e.lead_id).length ?? 0,
      noShows: allEvents?.filter((e) => e.no_show_detected).length ?? 0,
      rescheduled: allEvents?.filter((e) => (e.reschedule_count ?? 0) >= 1).length ?? 0,
      events: allEvents?.slice(0, 10).map((e) => ({
        id: e.id,
        title: e.title,
        lead_id: e.lead_id,
        status: e.status,
        no_show_detected: e.no_show_detected,
        reschedule_count: e.reschedule_count,
      })),
    };

    // ── Step 1: Reschedule pattern detection ──────────────────────────
    const rescheduleResults: unknown[] = [];
    {
      const { data: events } = await db
        .from("calendar_events")
        .select("id, workspace_id, lead_id, reschedule_count, title")
        .gte("reschedule_count", 2)
        .not("lead_id", "is", null);

      if (events?.length) {
        for (const evt of events) {
          const { data: existing } = await db
            .from("meeting_health_signals")
            .select("id")
            .eq("event_id", evt.id)
            .eq("signal_type", "reschedule")
            .limit(1);

          if (existing?.length) {
            rescheduleResults.push({ event: evt.title, status: "signal_already_exists" });
            continue;
          }

          const { error: insertErr } = await db.from("meeting_health_signals").insert({
            workspace_id: evt.workspace_id,
            lead_id: evt.lead_id,
            signal_type: "reschedule",
            severity: (evt.reschedule_count ?? 0) >= 3 ? "critical" : "warning",
            event_id: evt.id,
            details: {
              reschedule_count: evt.reschedule_count,
              message: `This lead has rescheduled ${evt.reschedule_count} times. Interest may be cooling.`,
            },
          });

          if (insertErr) {
            rescheduleResults.push({ event: evt.title, status: "insert_error", error: insertErr.message });
          } else {
            rescheduleResults.push({ event: evt.title, status: "signal_created", reschedule_count: evt.reschedule_count });
            signalsCreated++;
          }
        }
      }
    }
    steps.reschedulePatterns = {
      eventsWithReschedules: rescheduleResults.length,
      results: rescheduleResults.length > 0 ? rescheduleResults : "No events with 2+ reschedules found",
    };

    // ── Step 2: Meeting fatigue detection ─────────────────────────────
    const fatigueResults: unknown[] = [];
    {
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, stage, contact_name, company_name")
        .is("resolution", null);

      if (leads?.length) {
        for (const lead of leads) {
          const { data: meetings } = await db
            .from("calendar_events")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("status", "confirmed")
            .not("no_show_detected", "is", true);

          if (!meetings || meetings.length < 3) {
            fatigueResults.push({
              lead: lead.contact_name,
              meetings: meetings?.length ?? 0,
              status: "not_enough_meetings",
            });
            continue;
          }

          const { data: existing } = await db
            .from("meeting_health_signals")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("signal_type", "fatigue")
            .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (existing?.length) {
            fatigueResults.push({ lead: lead.contact_name, status: "signal_already_exists" });
            continue;
          }

          const { error: insertErr } = await db.from("meeting_health_signals").insert({
            workspace_id: lead.workspace_id,
            lead_id: lead.id,
            signal_type: "fatigue",
            severity: "warning",
            details: {
              meeting_count: meetings.length,
              current_stage: lead.stage,
              message: `${meetings.length} meetings with ${lead.company_name ?? lead.contact_name} with no stage progression (still in ${lead.stage}).`,
            },
          });

          if (insertErr) {
            fatigueResults.push({ lead: lead.contact_name, status: "insert_error", error: insertErr.message });
          } else {
            fatigueResults.push({ lead: lead.contact_name, status: "signal_created", meetings: meetings.length, stage: lead.stage });
            signalsCreated++;
          }
        }
      }
    }
    steps.meetingFatigue = {
      leadsChecked: fatigueResults.length,
      results: fatigueResults.length > 0 ? fatigueResults : "No unresolved leads found",
    };

    // ── Step 3: No-show frequency ─────────────────────────────────────
    const noShowResults: unknown[] = [];
    {
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name")
        .is("resolution", null);

      if (leads?.length) {
        for (const lead of leads) {
          const { data: allMeetings } = await db
            .from("calendar_events")
            .select("id, no_show_detected")
            .eq("lead_id", lead.id);

          if (!allMeetings || allMeetings.length < 2) {
            noShowResults.push({ lead: lead.contact_name, meetings: allMeetings?.length ?? 0, status: "not_enough_meetings" });
            continue;
          }

          const noShowCount = allMeetings.filter((m) => m.no_show_detected).length;
          const noShowRate = noShowCount / allMeetings.length;

          if (noShowCount < 2) {
            noShowResults.push({ lead: lead.contact_name, noShows: noShowCount, total: allMeetings.length, status: "below_threshold" });
            continue;
          }

          const severity = noShowRate >= 0.5 ? "critical" : "warning";

          const { data: existing } = await db
            .from("meeting_health_signals")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("signal_type", "no_show")
            .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (existing?.length) {
            noShowResults.push({ lead: lead.contact_name, status: "signal_already_exists" });
            continue;
          }

          const { error: insertErr } = await db.from("meeting_health_signals").insert({
            workspace_id: lead.workspace_id,
            lead_id: lead.id,
            signal_type: "no_show",
            severity,
            details: {
              no_show_count: noShowCount,
              total_meetings: allMeetings.length,
              no_show_rate: Math.round(noShowRate * 100),
              message:
                noShowRate >= 0.5
                  ? `${noShowCount} out of ${allMeetings.length} meetings were no-shows (${Math.round(noShowRate * 100)}%). Consider deprioritising this lead.`
                  : `${noShowCount} no-shows out of ${allMeetings.length} meetings.`,
            },
          });

          if (insertErr) {
            noShowResults.push({ lead: lead.contact_name, status: "insert_error", error: insertErr.message });
          } else {
            noShowResults.push({ lead: lead.contact_name, status: "signal_created", severity, noShows: noShowCount, total: allMeetings.length });
            signalsCreated++;
          }
        }
      }
    }
    steps.noShowFrequency = {
      leadsChecked: noShowResults.length,
      results: noShowResults.length > 0 ? noShowResults : "No unresolved leads found",
    };

    // ── Step 4: Duration trend detection ──────────────────────────────
    const durationResults: unknown[] = [];
    {
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name")
        .is("resolution", null);

      if (leads?.length) {
        for (const lead of leads) {
          const { data: meetings } = await db
            .from("calendar_events")
            .select("id, start_time, end_time")
            .eq("lead_id", lead.id)
            .eq("status", "confirmed")
            .order("start_time", { ascending: true });

          if (!meetings || meetings.length < 3) {
            durationResults.push({ lead: lead.contact_name, meetings: meetings?.length ?? 0, status: "not_enough_meetings" });
            continue;
          }

          const durations = meetings.map(
            (m) => (new Date(m.end_time).getTime() - new Date(m.start_time).getTime()) / 60000
          );

          let decreasing = true;
          for (let i = 1; i < durations.length; i++) {
            if (durations[i] >= durations[i - 1]) {
              decreasing = false;
              break;
            }
          }

          if (!decreasing) {
            durationResults.push({ lead: lead.contact_name, durations, status: "not_decreasing" });
            continue;
          }

          const { data: existing } = await db
            .from("meeting_health_signals")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("signal_type", "duration_drop")
            .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (existing?.length) {
            durationResults.push({ lead: lead.contact_name, status: "signal_already_exists" });
            continue;
          }

          const { error: insertErr } = await db.from("meeting_health_signals").insert({
            workspace_id: lead.workspace_id,
            lead_id: lead.id,
            signal_type: "duration_drop",
            severity: "info",
            details: {
              durations_minutes: durations,
              message: `Meetings with this lead are getting shorter (${durations.map((d) => d + "min").join(" → ")}). Engagement may be declining.`,
            },
          });

          if (insertErr) {
            durationResults.push({ lead: lead.contact_name, status: "insert_error", error: insertErr.message });
          } else {
            durationResults.push({ lead: lead.contact_name, status: "signal_created", durations });
            signalsCreated++;
          }
        }
      }
    }
    steps.durationTrends = {
      leadsChecked: durationResults.length,
      results: durationResults.length > 0 ? durationResults : "No unresolved leads found",
    };

    // ── Summary ───────────────────────────────────────────────────────
    // Check existing signals
    const { data: existingSignals } = await db
      .from("meeting_health_signals")
      .select("id, signal_type, severity, lead_id, details, created_at")
      .eq("workspace_id", WORKSPACE_ID)
      .order("created_at", { ascending: false })
      .limit(20);

    steps.existingSignals = {
      count: existingSignals?.length ?? 0,
      signals: existingSignals?.map((s) => ({
        type: s.signal_type,
        severity: s.severity,
        created: s.created_at,
        message: (s.details as Record<string, unknown>)?.message,
      })),
    };

    return NextResponse.json({
      status: "ok",
      signalsCreated,
      steps,
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({
      steps,
      error: e.message,
      stack: e.stack?.split("\n").slice(0, 8),
    }, { status: 500 });
  }
}

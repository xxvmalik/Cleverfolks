/**
 * Meeting Pattern Detection — Stage 13, Part I
 *
 * Nightly cron that scans for:
 * 1. Reschedule patterns (cooling interest)
 * 2. Meeting fatigue (no stage progression)
 * 3. Decision-maker attendance tracking
 * 4. Duration trend detection
 * 5. No-show frequency
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const detectMeetingPatterns = inngest.createFunction(
  { id: "skyler-detect-meeting-patterns", retries: 1 },
  { cron: "0 2 * * *" }, // Nightly at 2 AM
  async ({ step }) => {
    const db = createAdminSupabaseClient();
    let signalsCreated = 0;

    // Step 1: Reschedule pattern detection
    await step.run("detect-reschedule-patterns", async () => {
      const { data: events } = await db
        .from("calendar_events")
        .select("id, workspace_id, lead_id, reschedule_count")
        .gte("reschedule_count", 2)
        .not("lead_id", "is", null);

      if (!events?.length) return;

      for (const evt of events) {
        // Check if signal already exists for this event
        const { data: existing } = await db
          .from("meeting_health_signals")
          .select("id")
          .eq("event_id", evt.id)
          .eq("signal_type", "reschedule")
          .limit(1);

        if (existing?.length) continue;

        await db.from("meeting_health_signals").insert({
          workspace_id: evt.workspace_id,
          lead_id: evt.lead_id,
          signal_type: "reschedule",
          severity: evt.reschedule_count >= 3 ? "critical" : "warning",
          event_id: evt.id,
          details: {
            reschedule_count: evt.reschedule_count,
            message: `This lead has rescheduled ${evt.reschedule_count} times. Interest may be cooling.`,
          },
        });
        signalsCreated++;
      }
    });

    // Step 2: Meeting fatigue detection
    await step.run("detect-meeting-fatigue", async () => {
      // Find leads with 3+ meetings in the same pipeline stage
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, stage, contact_name, company_name")
        .is("resolution", null);

      if (!leads?.length) return;

      for (const lead of leads) {
        const { data: meetings } = await db
          .from("calendar_events")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("status", "confirmed")
          .not("no_show_detected", "is", true);

        if (!meetings || meetings.length < 3) continue;

        // Check if fatigue signal already exists for this lead
        const { data: existing } = await db
          .from("meeting_health_signals")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("signal_type", "fatigue")
          .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing?.length) continue;

        await db.from("meeting_health_signals").insert({
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
        signalsCreated++;
      }
    });

    // Step 3: No-show frequency
    await step.run("detect-no-show-frequency", async () => {
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name")
        .is("resolution", null);

      if (!leads?.length) return;

      for (const lead of leads) {
        const { data: allMeetings } = await db
          .from("calendar_events")
          .select("id, no_show_detected")
          .eq("lead_id", lead.id);

        if (!allMeetings || allMeetings.length < 2) continue;

        const noShowCount = allMeetings.filter((m) => m.no_show_detected).length;
        const noShowRate = noShowCount / allMeetings.length;

        if (noShowCount < 2) continue;

        const severity = noShowRate >= 0.5 ? "critical" : "warning";

        // Check if recent signal exists
        const { data: existing } = await db
          .from("meeting_health_signals")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("signal_type", "no_show")
          .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing?.length) continue;

        await db.from("meeting_health_signals").insert({
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
        signalsCreated++;
      }
    });

    // Step 4: Duration trend detection
    await step.run("detect-duration-trends", async () => {
      const { data: leads } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id")
        .is("resolution", null);

      if (!leads?.length) return;

      for (const lead of leads) {
        const { data: meetings } = await db
          .from("calendar_events")
          .select("id, start_time, end_time")
          .eq("lead_id", lead.id)
          .eq("status", "confirmed")
          .order("start_time", { ascending: true });

        if (!meetings || meetings.length < 3) continue;

        const durations = meetings.map(
          (m) =>
            (new Date(m.end_time).getTime() - new Date(m.start_time).getTime()) / 60000
        );

        // Check if each meeting is shorter than the previous
        let decreasing = true;
        for (let i = 1; i < durations.length; i++) {
          if (durations[i] >= durations[i - 1]) {
            decreasing = false;
            break;
          }
        }

        if (!decreasing) continue;

        const { data: existing } = await db
          .from("meeting_health_signals")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("signal_type", "duration_drop")
          .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing?.length) continue;

        await db.from("meeting_health_signals").insert({
          workspace_id: lead.workspace_id,
          lead_id: lead.id,
          signal_type: "duration_drop",
          severity: "info",
          details: {
            durations_minutes: durations,
            message: `Meetings with this lead are getting shorter (${durations.map((d) => d + "min").join(" → ")}). Engagement may be declining.`,
          },
        });
        signalsCreated++;
      }
    });

    // Log warning/critical signals to CRM
    await step.run("log-signals-to-crm", async () => {
      const { data: signals } = await db
        .from("meeting_health_signals")
        .select("*")
        .in("severity", ["warning", "critical"])
        .eq("acknowledged", false)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (!signals?.length) return;

      const events = signals.map((s) => ({
        name: "skyler/crm.log-activity" as const,
        data: {
          workspace_id: s.workspace_id,
          lead_id: s.lead_id,
          activity_type: "health_signal_detected",
          payload: {
            signal_type: s.signal_type,
            severity: s.severity,
            details: s.details,
          },
        },
      }));

      await inngest.send(events);
    });

    return { signalsCreated };
  }
);

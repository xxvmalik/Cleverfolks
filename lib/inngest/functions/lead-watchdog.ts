/**
 * Stage 15 — Watchdog Timers (Per-Lead Deadlines).
 *
 * Every lead gets a durable timer when entering a stage. If nothing happens
 * within the deadline, the system forces a re-evaluation. Auto-cancels on
 * stage change via Inngest cancelOn.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Stage timeout configuration (in hours) ──────────────────────────────────

const STAGE_TIMEOUTS: Record<string, number> = {
  initial_outreach: 72, // 3 days
  follow_up_1: 120, // 5 days
  follow_up_2: 120, // 5 days
  follow_up_3: 168, // 7 days
  replied: 72, // 3 days
  demo_booked: 48, // 48 hours (adjusted from meeting end time below)
  pending_clarification: 120, // 5 days
  negotiation: 336, // 14 days
  proposal: 336, // 14 days
  stalled: 720, // 30 days
  meeting_booked: 48, // 48 hours
  follow_up_meeting: 120, // 5 days
};

export const leadWatchdog = inngest.createFunction(
  {
    id: "lead-watchdog",
    retries: 0,
    cancelOn: [
      {
        event: "pipeline/lead.entered-stage",
        if: "async.data.leadId == event.data.leadId",
      },
    ],
  },
  { event: "pipeline/lead.entered-stage" },
  async ({ event, step }) => {
    const { leadId, stage } = event.data as {
      leadId: string;
      stage: string;
    };

    const timeoutHours = STAGE_TIMEOUTS[stage];
    if (!timeoutHours) {
      // Terminal stages (closed_won, closed_lost, disqualified) — no watchdog
      return { skipped: true, stage, reason: "no_timeout_configured" };
    }

    // For demo_booked and meeting_booked, try to use the meeting's end time
    let sleepMs = timeoutHours * 60 * 60 * 1000;

    if (stage === "demo_booked" || stage === "meeting_booked") {
      const meetingEnd = await step.run("get-meeting-end-time", async () => {
        const db = createAdminSupabaseClient();
        const { data } = await db
          .from("calendar_events")
          .select("end_time")
          .eq("lead_id", leadId)
          .gte("end_time", new Date().toISOString())
          .order("start_time", { ascending: true })
          .limit(1)
          .maybeSingle();

        return data?.end_time ?? null;
      });

      if (meetingEnd) {
        // Sleep until 48 hours after the meeting ends
        const meetingEndMs = new Date(meetingEnd).getTime();
        const targetMs = meetingEndMs + 48 * 60 * 60 * 1000;
        sleepMs = Math.max(targetMs - Date.now(), 60 * 1000); // at least 1 minute
      }
    }

    // Sleep for the timeout duration (zero compute while waiting)
    const sleepDuration = `${Math.ceil(sleepMs / 1000)}s`;
    await step.sleep("watchdog-wait", sleepDuration);

    // Timer fired — check if the lead is still in the same stage
    const shouldEvaluate = await step.run("check-still-stuck", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("stage, resolution")
        .eq("id", leadId)
        .single();

      if (!data) return false;
      if (data.resolution) return false; // Already resolved
      return data.stage === stage; // Still in the same stage
    });

    if (!shouldEvaluate) {
      return { skipped: true, leadId, stage, reason: "stage_already_changed" };
    }

    // Emit evaluation event
    await step.run("emit-evaluation", async () => {
      const db = createAdminSupabaseClient();

      // Log the watchdog firing
      try {
        await db
          .from("pipeline_events")
          .insert({
            lead_id: leadId,
            event_type: "watchdog_timeout",
            from_stage: stage,
            source: "watchdog",
            source_detail: `${timeoutHours}h timeout expired`,
            payload: { stage, timeout_hours: timeoutHours },
          });
      } catch { /* audit logging should never block */ }

      // Get lead details for the evaluation event
      const { data: lead } = await db
        .from("skyler_sales_pipeline")
        .select("workspace_id, contact_email, contact_name, company_name")
        .eq("id", leadId)
        .single();

      if (!lead) return;

      // Emit a reasoning event so the AI evaluates what to do
      await inngest.send({
        name: "skyler/reasoning.followup-due",
        data: {
          pipelineId: leadId,
          workspaceId: lead.workspace_id,
          contactEmail: lead.contact_email,
          contactName: lead.contact_name,
          companyName: lead.company_name,
          reason: "watchdog_timeout",
          stageAtTimeout: stage,
          timeoutHours: timeoutHours,
        },
      });

      console.log(
        `[watchdog] Timer fired for ${lead.contact_name}: stuck in ${stage} for ${timeoutHours}h`
      );
    });

    return { evaluated: true, leadId, stage };
  }
);

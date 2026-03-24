import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 1. Pipeline record
  console.log("=== PIPELINE RECORD ===");
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("*")
    .ilike("contact_name", "%doubra%")
    .maybeSingle();

  if (!pipeline) {
    console.log("No pipeline record found for Doubra");
    return;
  }

  console.log(JSON.stringify({
    id: pipeline.id,
    contact_name: pipeline.contact_name,
    contact_email: pipeline.contact_email,
    company_name: pipeline.company_name,
    stage: pipeline.stage,
    resolution: pipeline.resolution,
    meeting_outcome: pipeline.meeting_outcome,
    meeting_transcript: pipeline.meeting_transcript ? `${(pipeline.meeting_transcript as string).length} chars` : null,
    recall_bot_id: pipeline.recall_bot_id,
    meeting_event_id: pipeline.meeting_event_id,
    meeting_details: pipeline.meeting_details,
    awaiting_reply: pipeline.awaiting_reply,
    cadence_paused: pipeline.cadence_paused,
    no_show_detected: pipeline.no_show_detected,
    updated_at: pipeline.updated_at,
    created_at: pipeline.created_at,
  }, null, 2));

  const pipelineId = pipeline.id;

  // 2. Calendar events
  console.log("\n=== CALENDAR EVENTS ===");
  const { data: calEvents } = await db
    .from("calendar_events")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("start_time", { ascending: false });

  if (calEvents?.length) {
    for (const ev of calEvents) {
      console.log(JSON.stringify({
        id: ev.id,
        title: ev.title,
        start_time: ev.start_time,
        end_time: ev.end_time,
        status: ev.status,
        no_show_detected: ev.no_show_detected,
        no_show_checked_at: ev.no_show_checked_at,
        recall_bot_id: ev.recall_bot_id,
        recall_bot_status: ev.recall_bot_status,
        created_at: ev.created_at,
        updated_at: ev.updated_at,
      }, null, 2));
    }
  } else {
    console.log("No calendar events found");
  }

  // 3. Recall bots
  console.log("\n=== RECALL BOTS ===");
  const { data: bots } = await db
    .from("recall_bots")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("created_at", { ascending: false });

  if (bots?.length) {
    for (const bot of bots) {
      console.log(JSON.stringify(bot, null, 2));
    }
  } else {
    // Also try by pipeline recall_bot_id
    if (pipeline.recall_bot_id) {
      const { data: bot } = await db
        .from("recall_bots")
        .select("*")
        .eq("recall_bot_id", pipeline.recall_bot_id)
        .maybeSingle();
      if (bot) {
        console.log(JSON.stringify(bot, null, 2));
      } else {
        console.log(`No recall_bots record for bot ID ${pipeline.recall_bot_id}`);
      }
    } else {
      console.log("No recall bots found (no recall_bot_id on pipeline either)");
    }
  }

  // 4. Meeting transcripts
  console.log("\n=== MEETING TRANSCRIPTS ===");
  const { data: transcripts } = await db
    .from("meeting_transcripts")
    .select("id, bot_id, processing_status, summary, created_at, updated_at")
    .or(`lead_id.eq.${pipelineId},pipeline_id.eq.${pipelineId}`)
    .order("created_at", { ascending: false });

  if (transcripts?.length) {
    for (const t of transcripts) {
      console.log(JSON.stringify(t, null, 2));
    }
  } else {
    console.log("No meeting_transcripts records found");
  }

  // 5. Meeting health signals
  console.log("\n=== MEETING HEALTH SIGNALS ===");
  const { data: signals } = await db
    .from("meeting_health_signals")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("created_at", { ascending: false });

  if (signals?.length) {
    for (const s of signals) {
      console.log(JSON.stringify(s, null, 2));
    }
  } else {
    console.log("No health signals found");
  }

  // 6. Skyler decisions
  console.log("\n=== SKYLER DECISIONS ===");
  const { data: decisions } = await db
    .from("skyler_decisions")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false });

  if (decisions?.length) {
    for (const d of decisions) {
      console.log(JSON.stringify({
        id: d.id,
        event_type: d.event_type,
        decision: d.decision,
        guardrail_outcome: d.guardrail_outcome,
        execution_result: d.execution_result,
        created_at: d.created_at,
      }, null, 2));
    }
  } else {
    console.log("No skyler_decisions found");
  }

  // 7. Pipeline events (new Stage 15 table)
  console.log("\n=== PIPELINE EVENTS ===");
  const { data: events } = await db
    .from("pipeline_events")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("created_at", { ascending: false });

  if (events?.length) {
    for (const e of events) {
      console.log(JSON.stringify(e, null, 2));
    }
  } else {
    console.log("No pipeline_events found");
  }

  // 8. Skyler notifications
  console.log("\n=== SKYLER NOTIFICATIONS ===");
  const { data: notifs } = await db
    .from("skyler_notifications")
    .select("id, event_type, title, body, created_at")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (notifs?.length) {
    for (const n of notifs) {
      console.log(JSON.stringify(n, null, 2));
    }
  } else {
    console.log("No notifications found");
  }
}

main().catch(console.error);

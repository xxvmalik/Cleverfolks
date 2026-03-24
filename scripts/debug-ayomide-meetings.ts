/**
 * Debug script: Find Ayomide Onako's pipeline record and all related
 * calendar_events + meeting_transcripts.
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/debug-ayomide-meetings.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing env vars. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.");
  console.error("  npx dotenv -e .env.local -- npx tsx scripts/debug-ayomide-meetings.ts");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log("\n━━━ STEP 1: Find pipeline record for Ayomide Onako ━━━\n");

  const { data: pipelines, error: pipelineErr } = await db
    .from("skyler_sales_pipeline")
    .select("*")
    .or("contact_name.ilike.%Onako%,contact_name.ilike.%Ayomide%");

  if (pipelineErr) {
    console.error("Pipeline query error:", pipelineErr.message);
    process.exit(1);
  }

  if (!pipelines || pipelines.length === 0) {
    console.log("  No pipeline records found matching 'Onako' or 'Ayomide'.");
    process.exit(0);
  }

  console.log(`  Found ${pipelines.length} pipeline record(s):\n`);
  for (const p of pipelines) {
    console.log(`  ID:            ${p.id}`);
    console.log(`  Contact Name:  ${p.contact_name}`);
    console.log(`  Contact Email: ${p.contact_email}`);
    console.log(`  Company:       ${p.company_name ?? "(none)"}`);
    console.log(`  Stage:         ${p.stage}`);
    console.log(`  Recall Bot ID: ${p.recall_bot_id ?? "(none)"}`);
    console.log(`  Meeting Details: ${JSON.stringify(p.meeting_details ?? null)}`);
    console.log(`  Created:       ${p.created_at}`);
    console.log(`  Updated:       ${p.updated_at}`);
    console.log();
  }

  // Use the first match
  const pipeline = pipelines[0];
  const pipelineId = pipeline.id;

  // ── STEP 2: All calendar_events for this pipeline ID ──────────────────

  console.log(`━━━ STEP 2: All calendar_events for pipeline ${pipelineId} ━━━\n`);

  const { data: events, error: eventsErr } = await db
    .from("calendar_events")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("start_time", { ascending: false });

  if (eventsErr) {
    console.error("Calendar events query error:", eventsErr.message);
  } else if (!events || events.length === 0) {
    console.log("  No calendar_events linked to this pipeline ID.\n");
  } else {
    console.log(`  Found ${events.length} calendar event(s):\n`);
    for (const e of events) {
      console.log(`  Event ID:        ${e.id}`);
      console.log(`  Title:           ${e.title}`);
      console.log(`  Start:           ${e.start_time}`);
      console.log(`  End:             ${e.end_time}`);
      console.log(`  Status:          ${e.status ?? "(null)"}`);
      console.log(`  Meeting URL:     ${e.meeting_url ?? "(none)"}`);
      console.log(`  Recall Bot ID:   ${e.recall_bot_id ?? "(none)"}`);
      console.log(`  No-show:         ${e.no_show_detected ?? false}`);
      console.log(`  Outcome Reason:  ${e.meeting_outcome_reason ?? "(none)"}`);
      console.log(`  Pre-call Brief:  ${e.pre_call_brief_sent ?? false}`);
      console.log(`  Attendees:       ${JSON.stringify(e.attendees ?? [])}`);
      console.log();
    }
  }

  // Also check for unlinked events matching contact email
  if (pipeline.contact_email) {
    console.log(`  Checking for unlinked events matching email: ${pipeline.contact_email}\n`);
    const { data: allEvents } = await db
      .from("calendar_events")
      .select("id, title, start_time, end_time, status, lead_id, attendees")
      .eq("workspace_id", pipeline.workspace_id)
      .is("lead_id", null)
      .order("start_time", { ascending: false })
      .limit(100);

    const email = pipeline.contact_email.toLowerCase();
    const matched = (allEvents ?? []).filter((e: Record<string, unknown>) => {
      const attendees = e.attendees as Array<{ email?: string }> | null;
      if (!attendees) return false;
      return attendees.some((a) => a.email?.toLowerCase() === email);
    });

    if (matched.length > 0) {
      console.log(`  Found ${matched.length} UNLINKED event(s) matching contact email:\n`);
      for (const e of matched) {
        console.log(`    Event ID: ${e.id} | ${e.title} | ${e.start_time} | status: ${e.status}`);
      }
      console.log();
    } else {
      console.log("  No unlinked events matching contact email.\n");
    }
  }

  // ── STEP 3: All meeting_transcripts for this pipeline ID ──────────────

  console.log(`━━━ STEP 3: All meeting_transcripts for pipeline ${pipelineId} ━━━\n`);

  const { data: transcripts, error: transcriptsErr } = await db
    .from("meeting_transcripts")
    .select("*")
    .eq("lead_id", pipelineId)
    .order("meeting_date", { ascending: false });

  if (transcriptsErr) {
    console.error("Transcripts query error:", transcriptsErr.message);
  } else if (!transcripts || transcripts.length === 0) {
    console.log("  No meeting_transcripts for this pipeline ID.\n");
  } else {
    console.log(`  Found ${transcripts.length} transcript(s):\n`);
    for (const t of transcripts) {
      console.log(`  Transcript ID:      ${t.id}`);
      console.log(`  Bot ID:             ${t.bot_id ?? "(none)"}`);
      console.log(`  Meeting Date:       ${t.meeting_date}`);
      console.log(`  Meeting URL:        ${t.meeting_url ?? "(none)"}`);
      console.log(`  Processing Status:  ${t.processing_status ?? "(null)"}`);
      console.log(`  Duration (s):       ${t.duration_seconds ?? "(null)"}`);
      console.log(`  Participants:       ${JSON.stringify(t.participants ?? [])}`);
      console.log(`  Summary:            ${t.summary ? t.summary.substring(0, 200) + "..." : "(none)"}`);
      console.log(`  Intelligence:       ${t.intelligence ? JSON.stringify(t.intelligence).substring(0, 200) + "..." : "(none)"}`);
      console.log();
    }
  }

  // ── STEP 4: Summary ───────────────────────────────────────────────────

  console.log("━━━ SUMMARY ━━━\n");
  console.log(`  Pipeline ID:        ${pipelineId}`);
  console.log(`  Contact:            ${pipeline.contact_name} <${pipeline.contact_email}>`);
  console.log(`  Stage:              ${pipeline.stage}`);
  console.log(`  recall_bot_id:      ${pipeline.recall_bot_id ?? "(NOT SET)"}`);
  console.log(`  Calendar events:    ${events?.length ?? 0}`);
  console.log(`  Transcripts:        ${transcripts?.length ?? 0}`);
  console.log();
}

main().catch(console.error);

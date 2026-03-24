/**
 * Manual reconciliation trigger — runs the same checks as the cron function.
 * Usage: npx tsx scripts/reconcile-now.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("=== Manual Pipeline Reconciliation ===\n");

  // Step 1: Find all leads stuck in demo_booked / meeting_booked
  const { data: stuckLeads } = await db
    .from("skyler_sales_pipeline")
    .select("id, workspace_id, contact_name, contact_email, company_name, stage, meeting_transcript, meeting_outcome, updated_at")
    .in("stage", ["demo_booked", "meeting_booked"])
    .is("resolution", null);

  console.log(`Found ${stuckLeads?.length ?? 0} leads in demo_booked/meeting_booked:\n`);

  for (const lead of stuckLeads ?? []) {
    const hasTranscript = lead.meeting_transcript && (lead.meeting_transcript as string).length > 50;
    const hasOutcome = !!lead.meeting_outcome;

    // Check for completed calendar events
    const { data: completedMeeting } = await db
      .from("calendar_events")
      .select("id, end_time, title")
      .eq("lead_id", lead.id)
      .lt("end_time", new Date().toISOString())
      .order("end_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log(`  ${lead.contact_name} (${lead.stage})`);
    console.log(`    Pipeline ID: ${lead.id}`);
    console.log(`    Has transcript: ${hasTranscript ? "YES (" + (lead.meeting_transcript as string).length + " chars)" : "NO"}`);
    console.log(`    Has outcome: ${hasOutcome ? "YES" : "NO"}`);
    console.log(`    Completed meeting: ${completedMeeting ? `YES (ended ${completedMeeting.end_time})` : "NO"}`);
    console.log(`    Last updated: ${lead.updated_at}`);
    console.log();
  }

  // Step 2: Also check for transcript-exists-but-not-processed (CHECK 2)
  const { data: unprocessed } = await db
    .from("skyler_sales_pipeline")
    .select("id, workspace_id, contact_name, contact_email, company_name, stage, meeting_outcome")
    .not("meeting_transcript", "is", null)
    .is("meeting_outcome", null)
    .is("resolution", null);

  console.log(`\nFound ${unprocessed?.length ?? 0} leads with transcript but no outcome:\n`);

  for (const lead of unprocessed ?? []) {
    console.log(`  ${lead.contact_name} — stage: ${lead.stage}`);
    console.log(`    Pipeline ID: ${lead.id}`);
    console.log(`    Workspace: ${lead.workspace_id}`);
  }

  // Step 3: Trigger processing for unprocessed leads
  if (unprocessed && unprocessed.length > 0) {
    console.log("\n=== Triggering transcript processing ===\n");

    const INNGEST_URL = process.env.INNGEST_EVENT_URL || process.env.NEXT_PUBLIC_INNGEST_URL || "http://localhost:8288";
    const INNGEST_KEY = process.env.INNGEST_EVENT_KEY;

    for (const lead of unprocessed) {
      const eventPayload = {
        name: "skyler/meeting.transcript.ready",
        data: {
          pipelineId: lead.id,
          workspaceId: lead.workspace_id,
          botId: "manual-reconciliation",
          contactEmail: lead.contact_email,
          contactName: lead.contact_name,
          companyName: lead.company_name,
          source: "reconciliation",
          reason: "manual_trigger",
        },
      };

      console.log(`  Sending event for ${lead.contact_name}...`);

      try {
        // Try Inngest event API
        const url = `${INNGEST_URL}/e/${INNGEST_KEY ?? ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventPayload),
        });

        if (res.ok) {
          console.log(`    ✓ Event sent via Inngest API`);
        } else {
          console.log(`    ✗ Inngest API failed (${res.status}), trying direct...`);
          // Fallback: directly call the processing steps we know work
          await triggerDirectProcessing(lead);
        }
      } catch {
        console.log(`    ✗ Inngest not reachable, trying direct processing...`);
        await triggerDirectProcessing(lead);
      }
    }
  } else {
    console.log("\nNo leads need processing. Checking if Ayomide's outcome needs re-evaluation...\n");

    // Maybe Ayomide has an outcome but stage didn't update
    const { data: ayomide } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, stage, meeting_outcome, resolution")
      .ilike("contact_name", "%ayomide%")
      .maybeSingle();

    if (ayomide) {
      console.log(`  Ayomide found:`);
      console.log(`    Stage: ${ayomide.stage}`);
      console.log(`    Meeting outcome: ${JSON.stringify(ayomide.meeting_outcome)}`);
      console.log(`    Resolution: ${ayomide.resolution ?? "none"}`);
    } else {
      console.log("  Ayomide not found in pipeline.");
    }
  }

  // Step 4: Fix leads where outcome exists but stage didn't update
  const { data: outcomeStuck } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_name, stage, meeting_outcome, resolution")
    .in("stage", ["demo_booked", "meeting_booked"])
    .not("meeting_outcome", "is", null)
    .is("resolution", null);

  if (outcomeStuck && outcomeStuck.length > 0) {
    console.log(`\n=== Fixing ${outcomeStuck.length} leads with outcome but stuck stage ===\n`);

    for (const lead of outcomeStuck) {
      const outcome = lead.meeting_outcome as { outcome?: string; reasoning?: string } | null;
      if (!outcome?.outcome) continue;

      const stageMap: Record<string, string> = {
        won: "closed_won",
        proposal: "proposal",
        lost: "closed_lost",
        needs_follow_up: "follow_up_meeting",
      };

      const newStage = stageMap[outcome.outcome];
      if (!newStage) {
        console.log(`  ${lead.contact_name}: unknown outcome "${outcome.outcome}", skipping`);
        continue;
      }

      console.log(`  ${lead.contact_name}: ${lead.stage} → ${newStage} (outcome: ${outcome.outcome})`);
      console.log(`    Reasoning: ${outcome.reasoning}`);

      const updates: Record<string, unknown> = {
        stage: newStage,
        awaiting_reply: false,
        updated_at: new Date().toISOString(),
      };

      if (outcome.outcome === "won") {
        updates.resolution = "closed_won";
        updates.resolved_at = new Date().toISOString();
      } else if (outcome.outcome === "lost") {
        updates.resolution = "closed_lost";
        updates.resolved_at = new Date().toISOString();
      }

      const { error } = await db
        .from("skyler_sales_pipeline")
        .update(updates)
        .eq("id", lead.id);

      if (error) {
        console.log(`    ✗ Failed: ${error.message}`);
      } else {
        console.log(`    ✓ Stage updated to ${newStage}`);

        // Log to pipeline_events
        try {
          await db.from("pipeline_events").insert({
            lead_id: lead.id,
            event_type: "stage_changed",
            from_stage: lead.stage,
            to_stage: newStage,
            source: "reconciliation",
            source_detail: "manual_fix: outcome existed but stage stuck",
            payload: { outcome: outcome.outcome, reasoning: outcome.reasoning },
          });
          console.log(`    ✓ Event logged`);
        } catch {
          console.log(`    (event log skipped — table may not exist yet)`);
        }
      }
    }
  }

  console.log("\n=== Done ===");
}

async function triggerDirectProcessing(lead: { id: string; contact_name: string }) {
  // Get the transcript
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("meeting_transcript")
    .eq("id", lead.id)
    .single();

  const transcript = pipeline?.meeting_transcript as string | null;
  if (!transcript || transcript.length < 50) {
    console.log(`    ✗ Transcript too short (${transcript?.length ?? 0} chars)`);
    return;
  }

  console.log(`    Transcript: ${transcript.length} chars`);
  console.log(`    First 200 chars: ${transcript.slice(0, 200)}...`);
  console.log(`\n    To process this transcript, deploy to Vercel and the reconciliation cron`);
  console.log(`    will pick it up within 15 minutes. Or use the Inngest dashboard to`);
  console.log(`    manually invoke the "process-meeting-transcript" function.`);
}

main().catch(console.error);

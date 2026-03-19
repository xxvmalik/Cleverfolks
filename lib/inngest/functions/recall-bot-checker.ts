/**
 * Recall Bot Status Checker — safety net for webhook failures.
 *
 * Every 2 minutes, checks all active Recall bots. When a bot is done,
 * pulls the transcript via API and triggers processing — even if the
 * dashboard webhook never arrived.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallBotStatus, getRecallTranscript } from "@/lib/recall/client";

export const recallBotChecker = inngest.createFunction(
  {
    id: "recall-bot-checker",
    retries: 1,
  },
  { cron: "*/2 * * * *" }, // Every 2 minutes
  async ({ step }) => {
    // Step 1: Find pipeline records with a recall_bot_id but no meeting_outcome yet
    const activeBots = await step.run("find-active-bots", async () => {
      const db = createAdminSupabaseClient();

      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name, recall_bot_id, meeting_transcript, meeting_outcome")
        .not("recall_bot_id", "is", null)
        .is("meeting_outcome", null)
        .limit(20);

      if (error || !data) return [];

      console.log(`[recall-checker] Found ${data.length} active bots to check`);
      return data;
    });

    if (activeBots.length === 0) return { checked: 0, completed: 0 };

    let completed = 0;

    for (const record of activeBots) {
      const botId = record.recall_bot_id as string;

      const result = await step.run(`check-bot-${botId.slice(0, 8)}`, async () => {
        const status = await getRecallBotStatus(botId);
        if (!status) return "unknown";

        const botStatus = status.status;
        console.log(`[recall-checker] Bot ${botId.slice(0, 8)} status: ${botStatus}`);

        // Bot is still active — skip
        if (["joining_call", "in_waiting_room", "in_call_not_recording", "in_call_recording", "ready"].includes(botStatus)) {
          return "active";
        }

        // Bot is done — pull transcript and trigger processing
        if (botStatus === "done" || botStatus === "call_ended" || botStatus === "recording_done") {
          const db = createAdminSupabaseClient();

          // Pull transcript from Recall API
          const transcript = await getRecallTranscript(botId);
          if (transcript && transcript.trim().length > 0) {
            // Store transcript if we don't have one yet (webhook may have failed)
            const existing = (record.meeting_transcript as string) ?? "";
            if (transcript.length > existing.length) {
              await db
                .from("skyler_sales_pipeline")
                .update({ meeting_transcript: transcript, updated_at: new Date().toISOString() })
                .eq("id", record.id);
              console.log(`[recall-checker] Stored transcript (${transcript.length} chars) for pipeline ${(record.id as string).slice(0, 8)}`);
            }
          }

          // Check if already processed (meeting_outcome is set by meeting-transcript function)
          if (record.meeting_outcome) {
            console.log(`[recall-checker] Bot ${botId.slice(0, 8)} already processed, skipping`);
            return "already_processed";
          }

          // Fire the transcript processing event
          await inngest.send({
            name: "skyler/meeting.transcript.ready",
            data: {
              pipelineId: record.id,
              workspaceId: record.workspace_id,
              botId,
              contactEmail: record.contact_email,
              contactName: record.contact_name,
              companyName: record.company_name,
            },
          });

          // Mark as having a pending outcome so cron doesn't re-fire
          // (the meeting-transcript function will set the real outcome)
          await db
            .from("skyler_sales_pipeline")
            .update({ meeting_outcome: { processing: true }, updated_at: new Date().toISOString() })
            .eq("id", record.id)
            .is("meeting_outcome", null);

          console.log(`[recall-checker] Bot ${botId.slice(0, 8)} done — fired transcript processing`);
          return "completed";
        }

        // Bot failed
        if (botStatus === "fatal" || botStatus === "error") {
          const db = createAdminSupabaseClient();
          await db
            .from("skyler_sales_pipeline")
            .update({
              meeting_outcome: { error: `Bot failed with status: ${botStatus}` },
              updated_at: new Date().toISOString(),
            })
            .eq("id", record.id);
          console.log(`[recall-checker] Bot ${botId.slice(0, 8)} failed: ${botStatus}`);
          return "failed";
        }

        return botStatus;
      });

      if (result === "completed") completed++;
    }

    console.log(`[recall-checker] Checked ${activeBots.length} bots, ${completed} completed`);
    return { checked: activeBots.length, completed };
  }
);

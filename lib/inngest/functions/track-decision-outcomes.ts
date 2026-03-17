/**
 * Decision Outcome Tracker (Stage 11, Part G).
 *
 * Runs every 6 hours. For decisions executed in the last 72 hours,
 * checks CRM outcomes and updates golden example scores.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { updateOutcomeScore } from "@/lib/skyler/learning/golden-examples";

export const trackDecisionOutcomes = inngest.createFunction(
  {
    id: "skyler-track-decision-outcomes",
    retries: 1,
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    const results = await step.run("check-outcomes", async () => {
      const db = createAdminSupabaseClient();
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      // Find golden examples created in the last 72h that don't have an outcome score yet
      const { data: examples } = await db
        .from("golden_examples")
        .select("id, decision_id, workspace_id, lead_id, created_at")
        .is("outcome_score", null)
        .gte("created_at", cutoff)
        .eq("is_active", true)
        .limit(100);

      if (!examples || examples.length === 0) {
        return { checked: 0, updated: 0 };
      }

      let updated = 0;

      for (const example of examples) {
        if (!example.lead_id) continue;

        // Check pipeline record for outcome signals
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("emails_replied, stage, resolution, meeting_event_id")
          .eq("id", example.lead_id)
          .single();

        if (!pipeline) continue;

        // Calculate outcome score based on signals
        let outcomeScore = 0.0;

        // Check for new replies since the decision
        if ((pipeline.emails_replied ?? 0) > 0) {
          // Check if any reply came after this decision
          const { data: thread } = await db
            .from("skyler_sales_pipeline")
            .select("conversation_thread")
            .eq("id", example.lead_id)
            .single();

          const messages = ((thread?.conversation_thread ?? []) as Array<{ role: string; timestamp: string }>);
          const recentReply = messages.find(
            (m) => m.role === "lead" && new Date(m.timestamp) > new Date(example.created_at)
          );

          if (recentReply) {
            outcomeScore += 1.5; // Lead replied
          }
        }

        // Check for stage progression
        const stageOrder = [
          "initial_outreach", "follow_up_1", "follow_up_2", "follow_up_3",
          "replied", "negotiation", "demo_booked", "meeting_booked",
          "follow_up_meeting", "proposal", "closed_won",
        ];
        const currentIdx = stageOrder.indexOf(pipeline.stage ?? "");
        if (currentIdx >= stageOrder.indexOf("replied")) {
          outcomeScore += 1.5; // Deal progressed
        }

        // Check for meeting booked
        if (pipeline.meeting_event_id) {
          outcomeScore += 2.0;
        }

        // Check for negative outcome
        if (pipeline.resolution === "lost") {
          outcomeScore = -1.0;
        } else if (pipeline.resolution === "won") {
          outcomeScore += 2.0;
        }

        if (outcomeScore !== 0.0) {
          await updateOutcomeScore(db, example.id, outcomeScore);
          updated++;
        }
      }

      return { checked: examples.length, updated };
    });

    console.log(`[track-outcomes] Checked ${results.checked}, updated ${results.updated}`);
    return results;
  }
);

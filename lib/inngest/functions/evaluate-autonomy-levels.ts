/**
 * Autonomy Level Evaluator (Stage 11, Part F).
 *
 * Runs weekly. Evaluates each task type's confidence tracking and
 * promotes/demotes autonomy levels based on track record.
 * Notifies user on any level change.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { dispatchNotification } from "@/lib/skyler/notifications";

export const evaluateAutonomyLevels = inngest.createFunction(
  {
    id: "skyler-evaluate-autonomy-levels",
    retries: 1,
  },
  { cron: "0 9 * * 1" }, // Every Monday at 9 AM
  async ({ step }) => {
    const results = await step.run("evaluate", async () => {
      const db = createAdminSupabaseClient();

      const { data: records } = await db
        .from("confidence_tracking")
        .select("*")
        .gt("total_decisions", 0);

      if (!records || records.length === 0) return { evaluated: 0, changes: 0 };

      let changes = 0;

      for (const record of records) {
        const oldLevel = record.autonomy_level;
        let newLevel = oldLevel;

        // Promotion: ewma > 0.90 for 30+ decisions
        if (record.ewma >= 0.90 && record.total_decisions >= 30 && oldLevel !== "autonomous") {
          newLevel = "autonomous";
        }
        // Demotion: ewma drops below 0.60
        else if (record.ewma < 0.60 && oldLevel !== "blocked") {
          newLevel = "blocked";
        }
        // Normal review level
        else if (record.ewma >= 0.60 && record.ewma < 0.85 && oldLevel === "autonomous") {
          newLevel = "review";
        }

        if (newLevel !== oldLevel) {
          await db
            .from("confidence_tracking")
            .update({
              autonomy_level: newLevel,
              last_updated_at: new Date().toISOString(),
            })
            .eq("id", record.id);

          // Notify user
          const approvalRate = Math.round((record.alpha / (record.alpha + record.beta)) * 100);
          const direction = newLevel === "autonomous" ? "promoted" : newLevel === "blocked" ? "demoted" : "adjusted";

          await dispatchNotification(db, {
            workspaceId: record.workspace_id,
            eventType: "escalation_triggered",
            title: `Skyler's ${record.task_type.replace(/_/g, " ")} autonomy ${direction}`,
            body: `Approval rate: ${approvalRate}% over ${record.total_decisions} decisions. New level: ${newLevel}.`,
          });

          changes++;
          console.log(`[evaluate-autonomy] ${record.workspace_id}/${record.task_type}: ${oldLevel} → ${newLevel}`);
        }
      }

      return { evaluated: records.length, changes };
    });

    return results;
  }
);

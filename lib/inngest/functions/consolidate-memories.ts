/**
 * Memory Consolidation & Pruning (Stage 11, Part H).
 *
 * Daily cron that:
 * - Expires stale corrections (>90 days, low access, low confidence)
 * - Expires corrections past their expires_at date
 * - Enforces memory budget (500 active per workspace)
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const consolidateMemories = inngest.createFunction(
  {
    id: "skyler-consolidate-memories",
    retries: 1,
  },
  { cron: "0 3 * * *" }, // Daily at 3 AM
  async ({ step }) => {
    const results = await step.run("consolidate", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();
      let expired = 0;
      let pruned = 0;

      // 1. Expire corrections past their expires_at date
      const { data: expiredData } = await db
        .from("agent_corrections")
        .update({ is_active: false })
        .eq("is_active", true)
        .lt("expires_at", now)
        .not("expires_at", "is", null)
        .select("id");

      expired += expiredData?.length ?? 0;

      // 2. Soft-expire: corrections >90 days old with access_count < 2 AND confidence < 0.5
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleData } = await db
        .from("agent_corrections")
        .update({ is_active: false })
        .eq("is_active", true)
        .lt("created_at", ninetyDaysAgo)
        .lt("access_count", 2)
        .lt("confidence", 0.5)
        .select("id");

      expired += staleData?.length ?? 0;

      // 3. Expire stale golden examples (>90 days, never used, low score)
      const { data: staleExamplesData } = await db
        .from("golden_examples")
        .update({ is_active: false })
        .eq("is_active", true)
        .lt("created_at", ninetyDaysAgo)
        .eq("use_count", 0)
        .lt("composite_score", 0.3)
        .select("id");

      pruned += staleExamplesData?.length ?? 0;

      // 4. Budget check: corrections per workspace (max 500)
      const { data: workspaces } = await db
        .from("agent_corrections")
        .select("workspace_id")
        .eq("is_active", true);

      const wsCounts = new Map<string, number>();
      for (const c of workspaces ?? []) {
        wsCounts.set(c.workspace_id, (wsCounts.get(c.workspace_id) ?? 0) + 1);
      }

      for (const [wsId, count] of wsCounts) {
        if (count > 500) {
          const excess = count - 500;
          // Deactivate lowest-confidence corrections
          const { data: toRemove } = await db
            .from("agent_corrections")
            .select("id")
            .eq("workspace_id", wsId)
            .eq("is_active", true)
            .order("confidence", { ascending: true })
            .order("access_count", { ascending: true })
            .limit(excess);

          if (toRemove && toRemove.length > 0) {
            await db
              .from("agent_corrections")
              .update({ is_active: false })
              .in("id", toRemove.map((r) => r.id));

            pruned += toRemove.length;
          }
        }
      }

      // 5. Hard delete: inactive for 6+ months
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      await db
        .from("agent_corrections")
        .delete()
        .eq("is_active", false)
        .lt("created_at", sixMonthsAgo);

      await db
        .from("golden_examples")
        .delete()
        .eq("is_active", false)
        .lt("created_at", sixMonthsAgo);

      return { expired, pruned };
    });

    console.log(`[consolidate-memories] Expired: ${results.expired}, Pruned: ${results.pruned}`);
    return results;
  }
);

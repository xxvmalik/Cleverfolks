/**
 * Auto-confirm knowledge profiles that have been in "pending_review" for 24+ hours.
 *
 * Knowledge profiles can sit in pending_review indefinitely when no user reviews them.
 * This cron runs daily and auto-confirms any profile that's been pending for 24+ hours,
 * so agents always have access to the latest business intelligence.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const autoConfirmKnowledgeProfiles = inngest.createFunction(
  {
    id: "auto-confirm-knowledge-profiles",
    name: "Auto-Confirm Pending Knowledge Profiles",
  },
  { cron: "0 3 * * *" }, // Run daily at 3 AM UTC
  async ({ step }) => {
    const confirmed = await step.run("confirm-stale-profiles", async () => {
      const db = createAdminSupabaseClient();

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Find profiles that have been pending_review for over 24 hours
      const { data: staleProfiles, error: fetchError } = await db
        .from("knowledge_profiles")
        .select("id, workspace_id, updated_at")
        .eq("status", "pending_review")
        .lt("updated_at", cutoff);

      if (fetchError) {
        console.error("[auto-confirm] Error fetching stale profiles:", fetchError.message);
        return { confirmed: 0, error: fetchError.message };
      }

      if (!staleProfiles || staleProfiles.length === 0) {
        console.log("[auto-confirm] No stale knowledge profiles to confirm");
        return { confirmed: 0 };
      }

      // Auto-confirm them
      const ids = staleProfiles.map((p) => p.id);
      const { error: updateError } = await db
        .from("knowledge_profiles")
        .update({ status: "ready" })
        .in("id", ids);

      if (updateError) {
        console.error("[auto-confirm] Error confirming profiles:", updateError.message);
        return { confirmed: 0, error: updateError.message };
      }

      console.log(
        `[auto-confirm] Auto-confirmed ${staleProfiles.length} knowledge profiles:`,
        staleProfiles.map((p) => p.workspace_id).join(", ")
      );

      return { confirmed: staleProfiles.length };
    });

    return confirmed;
  }
);

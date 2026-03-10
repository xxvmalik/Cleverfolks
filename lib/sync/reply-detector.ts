/**
 * Sync-time reply detection for Skyler Sales Closer.
 * Pure database lookup — ZERO AI cost.
 *
 * Checks if an incoming email sender matches an active pipeline contact.
 * If matched, updates the pipeline record and fires an Inngest event
 * so the sales closer workflow can draft a contextual reply.
 *
 * Dedup: skips if the pipeline was already updated within the last 5 minutes
 * (prevents double events from duplicate chunks or re-syncs).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { extractSenderFromText, extractSenderFromMetadata } from "./email-prefilter";

export type ReplyDetectionResult = {
  is_reply: boolean;
  pipeline_id?: string;
  contact_email?: string;
};

/**
 * Detect if an incoming email is a reply to a Sales Closer outreach.
 * Matches sender email against active pipeline records.
 *
 * Zero AI cost — pure DB lookups.
 * Never throws — returns { is_reply: false } on any error.
 */
export async function detectPipelineReply(
  db: SupabaseClient,
  workspaceId: string,
  record: {
    content: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ReplyDetectionResult> {
  try {
    // Extract sender email from metadata or text
    const senderEmail =
      extractSenderFromMetadata(record.metadata) ??
      extractSenderFromText(record.content);

    if (!senderEmail) return { is_reply: false };

    // Check if this sender has an active pipeline record (unresolved)
    // Match on resolution IS NULL (not just awaiting_reply) to catch replies
    // that arrive while a follow-up draft is pending approval
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_email, stage, awaiting_reply, emails_replied, conversation_thread, last_reply_at")
      .eq("workspace_id", workspaceId)
      .eq("contact_email", senderEmail)
      .is("resolution", null)
      .maybeSingle();

    if (!pipeline) return { is_reply: false };

    // Dedup guard: skip if last_reply_at was within the last 5 minutes
    // Prevents double events from duplicate chunks or re-syncs
    if (pipeline.last_reply_at) {
      const lastReply = new Date(pipeline.last_reply_at as string).getTime();
      if (Date.now() - lastReply < 5 * 60 * 1000) {
        console.log(
          `[reply-detector] Skipping duplicate reply from ${senderEmail} — last reply ${Math.round((Date.now() - lastReply) / 1000)}s ago`
        );
        return { is_reply: false };
      }
    }

    console.log(
      `[reply-detector] Reply detected from ${senderEmail} for pipeline ${pipeline.id} (stage: ${pipeline.stage})`
    );

    // Update pipeline record IMMEDIATELY with reply data
    const now = new Date().toISOString();
    const thread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
    thread.push({
      role: "prospect",
      content: record.content.slice(0, 3000),
      timestamp: now,
      status: "received",
    });

    const newStage =
      pipeline.stage === "initial_outreach" || (pipeline.stage as string).startsWith("follow_up")
        ? "replied"
        : pipeline.stage;

    await db
      .from("skyler_sales_pipeline")
      .update({
        awaiting_reply: false,
        last_reply_at: now,
        next_followup_at: null, // Cancel follow-up cadence immediately
        emails_replied: ((pipeline.emails_replied as number) ?? 0) + 1,
        stage: newStage,
        conversation_thread: thread,
        updated_at: now,
      })
      .eq("id", pipeline.id);

    console.log(
      `[reply-detector] Pipeline ${pipeline.id} updated — emails_replied: ${((pipeline.emails_replied as number) ?? 0) + 1}, stage: ${newStage}`
    );

    // Fire Inngest event for the sales closer to classify + draft a reply
    try {
      await inngest.send({
        name: "skyler/pipeline.reply.received",
        data: {
          pipelineId: pipeline.id,
          contactEmail: senderEmail,
          workspaceId,
          replyContent: record.content.slice(0, 3000),
          stage: pipeline.stage,
        },
      });
      console.log(`[reply-detector] Fired skyler/pipeline.reply.received for pipeline ${pipeline.id}`);
    } catch (inngestErr) {
      console.error("[reply-detector] Inngest event failed:", inngestErr);
    }

    return {
      is_reply: true,
      pipeline_id: pipeline.id,
      contact_email: senderEmail,
    };
  } catch (err) {
    console.warn(
      "[reply-detector] Detection failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { is_reply: false };
  }
}

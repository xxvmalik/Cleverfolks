/**
 * Sync-time reply detection for Skyler Sales Closer.
 * Pure database lookup — ZERO AI cost.
 *
 * Checks if an incoming email sender matches an active pipeline contact.
 * If matched, atomically claims the pipeline record, updates it with the
 * reply, and fires a single Inngest event for drafting a response.
 *
 * Dedup: uses atomic conditional update (reply_lock_until) to prevent
 * duplicate events from concurrent chunks of the same email.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { extractSenderFromText, extractSenderFromMetadata } from "./email-prefilter";
import { stageOnReply } from "@/lib/skyler/pipeline-stages";

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

    // Check if this sender has an active pipeline record (unresolved OR no_response)
    // no_response leads can be re-engaged when they reply
    const pipelineFields = "id, contact_email, stage, resolution, awaiting_reply, emails_replied, conversation_thread, last_reply_at";

    const { data: active } = await db
      .from("skyler_sales_pipeline")
      .select(pipelineFields)
      .eq("workspace_id", workspaceId)
      .eq("contact_email", senderEmail)
      .is("resolution", null)
      .maybeSingle();

    let pipeline = active;

    if (!pipeline) {
      // Check for no_response leads that can be re-engaged
      const { data: dormant } = await db
        .from("skyler_sales_pipeline")
        .select(pipelineFields)
        .eq("workspace_id", workspaceId)
        .eq("contact_email", senderEmail)
        .eq("resolution", "no_response")
        .maybeSingle();

      if (dormant) {
        pipeline = dormant;
        console.log(`[reply-detector] Re-engaging no_response lead ${dormant.id} from ${senderEmail}`);
      }
    }

    if (!pipeline) return { is_reply: false };

    // Content dedup: check if this reply already exists in the conversation thread.
    // The sync processor recreates chunks every cycle, so the same email will be
    // re-detected after the 5-minute atomic lock expires. Compare content to prevent duplicates.
    const existingThread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
    const replyContent = record.content.slice(0, 3000);
    const isDuplicate = existingThread.some(
      (entry) =>
        entry.role === "prospect" &&
        typeof entry.content === "string" &&
        (entry.content as string).slice(0, 200) === replyContent.slice(0, 200)
    );
    if (isDuplicate) {
      console.log(
        `[reply-detector] Skipping duplicate reply from ${senderEmail} — content already in thread for pipeline ${pipeline.id}`
      );
      return { is_reply: false };
    }

    // Atomic dedup: only proceed if last_reply_at is old enough (>5 min) or null.
    // This prevents two concurrent chunks of the same email from both firing events.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Build the new conversation thread with the prospect's reply (clone to avoid mutating the original)
    const thread = [...existingThread];
    // Find the last subject from Skyler's emails for context
    let lastSubject = "";
    for (let i = thread.length - 1; i >= 0; i--) {
      if (thread[i].subject) { lastSubject = thread[i].subject as string; break; }
    }
    thread.push({
      role: "prospect",
      content: record.content.slice(0, 3000),
      subject: lastSubject ? `re: ${lastSubject}` : undefined,
      timestamp: now,
      status: "received",
    });

    const isReEngaging = pipeline.resolution === "no_response";
    const newStage = isReEngaging
      ? stageOnReply("no_response")
      : stageOnReply(pipeline.stage as string);

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      awaiting_reply: false,
      last_reply_at: now,
      next_followup_at: null,
      emails_replied: ((pipeline.emails_replied as number) ?? 0) + 1,
      stage: newStage,
      conversation_thread: thread,
      updated_at: now,
    };

    // Clear resolution if re-engaging a no_response lead
    if (isReEngaging) {
      updatePayload.resolution = null;
      updatePayload.resolution_notes = null;
      updatePayload.resolved_at = null;
      console.log(`[reply-detector] Clearing no_response resolution for pipeline ${pipeline.id}`);
    }

    // Atomic conditional update: only succeeds if last_reply_at is NULL or older than 5 min
    // This is the dedup mechanism — if two chunks race, only one update succeeds
    let updateQuery = db
      .from("skyler_sales_pipeline")
      .update(updatePayload)
      .eq("id", pipeline.id);

    // Add the atomic condition: last_reply_at must be null OR older than 5 min
    if (pipeline.last_reply_at) {
      updateQuery = updateQuery.lt("last_reply_at", fiveMinAgo);
    } else {
      updateQuery = updateQuery.is("last_reply_at", null);
    }

    const { data: updated, error: updateErr } = await updateQuery
      .select("id")
      .maybeSingle();

    if (updateErr) {
      console.error(`[reply-detector] Update error: ${updateErr.message}`);
      return { is_reply: false };
    }

    if (!updated) {
      console.log(
        `[reply-detector] Skipping duplicate reply from ${senderEmail} — pipeline ${pipeline.id} already updated recently`
      );
      return { is_reply: false };
    }

    console.log(
      `[reply-detector] Pipeline ${pipeline.id} updated — emails_replied: ${((pipeline.emails_replied as number) ?? 0) + 1}, stage: ${newStage}`
    );

    // Fire Inngest event — guaranteed single fire due to atomic update above
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

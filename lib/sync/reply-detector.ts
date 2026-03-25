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
import { logAgentActivity } from "@/lib/agent-activity";

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

    if (!senderEmail) {
      console.log(`[reply-detector] No sender email extracted`);
      return { is_reply: false };
    }

    console.log(`[reply-detector] Checking sender: ${senderEmail} in workspace ${workspaceId.slice(0, 8)}`);

    // Check if this sender has an active pipeline record.
    // "Active" means: unresolved, OR resolved as meeting_booked/demo_booked (still engaged),
    // OR resolved as no_response (can be re-engaged when they reply).
    const pipelineFields = "id, contact_email, stage, resolution, awaiting_reply, emails_replied, conversation_thread, last_reply_at";

    const { data: active } = await db
      .from("skyler_sales_pipeline")
      .select(pipelineFields)
      .eq("workspace_id", workspaceId)
      .ilike("contact_email", senderEmail)
      .is("resolution", null)
      .maybeSingle();

    let pipeline = active;

    if (!pipeline) {
      // Check for meeting_booked/demo_booked leads (engaged, not truly resolved)
      // and no_response leads (can be re-engaged)
      const { data: engaged } = await db
        .from("skyler_sales_pipeline")
        .select(pipelineFields)
        .eq("workspace_id", workspaceId)
        .ilike("contact_email", senderEmail)
        .in("resolution", ["meeting_booked", "demo_booked", "no_response"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (engaged) {
        pipeline = engaged;
        console.log(`[reply-detector] Found ${engaged.resolution} lead ${engaged.id} from ${senderEmail} — treating as active`);
      }
    }

    if (!pipeline) {
      console.log(`[reply-detector] No pipeline found for ${senderEmail}`);
      return { is_reply: false };
    }

    console.log(`[reply-detector] Found pipeline ${pipeline.id} (resolution: ${pipeline.resolution}, last_reply_at: ${pipeline.last_reply_at})`);

    // Content dedup: check if this reply already exists in the conversation thread.
    // The sync processor recreates chunks every cycle, so the same email will be
    // re-detected after the 5-minute atomic lock expires. Compare content to prevent duplicates.
    // NOTE: The same email can arrive with different formatting (with/without headers),
    // so we normalize by stripping email metadata before comparing.
    const existingThread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
    const replyContent = record.content.slice(0, 3000);
    const normalizedReply = normalizeReplyContent(replyContent);
    const isDuplicate = existingThread.some(
      (entry) =>
        entry.role === "prospect" &&
        typeof entry.content === "string" &&
        isSameReply(entry.content as string, normalizedReply)
    );
    console.log(`[reply-detector] Content dedup: isDuplicate=${isDuplicate}, threadEntries=${existingThread.length}, prospectEntries=${existingThread.filter(e => e.role === "prospect").length}`);

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

    // Any resolved lead that replies is re-engaging — clear resolution so
    // handlePipelineReply can process the reply (it skips resolved pipelines).
    // meeting_booked/demo_booked are stage markers, not true resolutions.
    const isReEngaging = ["no_response", "meeting_booked", "demo_booked"].includes(
      pipeline.resolution as string
    );
    const newStage = pipeline.resolution === "no_response"
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

    // Clear resolution when a "resolved" lead replies — they're re-engaging
    if (isReEngaging) {
      updatePayload.resolution = null;
      updatePayload.resolution_notes = null;
      updatePayload.resolved_at = null;
      console.log(`[reply-detector] Clearing ${pipeline.resolution} resolution for pipeline ${pipeline.id} — contact re-engaging`);
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

    console.log(`[reply-detector] Atomic update: last_reply_at=${pipeline.last_reply_at}, fiveMinAgo=${fiveMinAgo}, condition=${pipeline.last_reply_at ? "lt" : "is_null"}`);

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

    // Log to agent activity feed
    logAgentActivity(db, {
      workspaceId,
      agentType: "skyler",
      activityType: "reply_detected",
      title: `Reply detected from ${senderEmail}`,
      description: `${senderEmail} replied to outreach — stage updated to ${newStage}`,
      metadata: { emailsReplied: ((pipeline.emails_replied as number) ?? 0) + 1 },
      relatedEntityId: pipeline.id,
      relatedEntityType: "pipeline",
    }).catch(() => {});

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

// ── Content normalization helpers ────────────────────────────────────────────

/** Email header patterns that vary between sync cycles */
const HEADER_PATTERNS = [
  /^From:\s*.+$/gm,
  /^To:\s*.+$/gm,
  /^Cc:\s*.+$/gm,
  /^Subject:\s*.+$/gm,
  /^Date:\s*.+$/gm,
  /^Sent:\s*.+$/gm,
  /^[\w-]+:\s*.+→.+$/gm,                            // "From: x → To: y" compact headers
  /On\s+.{10,60}\s+wrote:\s*/gi,                     // "On Wed, Mar 25... wrote:"
  /^-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}$/gm, // ---- Original Message ----
  /^>{1,}\s*/gm,                                     // Quoted text markers
];

/**
 * Strip email headers and metadata from reply content to get the actual reply body.
 * This ensures the same email detected with/without headers still deduplicates.
 */
function normalizeReplyContent(content: string): string {
  let normalized = content;
  for (const pattern of HEADER_PATTERNS) {
    normalized = normalized.replace(pattern, "");
  }
  // Collapse whitespace and trim
  return normalized.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Check if two reply contents are the same email.
 * Normalizes both, then checks if one contains the other's core text.
 */
function isSameReply(existingContent: string, normalizedNewReply: string): boolean {
  const normalizedExisting = normalizeReplyContent(existingContent);

  // Direct match on first 150 normalized chars
  if (normalizedExisting.slice(0, 150) === normalizedNewReply.slice(0, 150)) {
    return true;
  }

  // Substring match: the core reply text (first 80 chars) appears in the other
  const coreNew = normalizedNewReply.slice(0, 80);
  const coreExisting = normalizedExisting.slice(0, 80);
  if (coreNew.length > 15 && normalizedExisting.includes(coreNew)) return true;
  if (coreExisting.length > 15 && normalizedNewReply.includes(coreExisting)) return true;

  return false;
}

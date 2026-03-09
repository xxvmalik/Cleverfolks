/**
 * Sync-time reply detection for Skyler Sales Closer.
 * Checks if an incoming email is a reply to one of our outreach emails
 * by matching the sender's email against the sales pipeline.
 * If a match is found, fires an Inngest event so the workflow can continue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";

export type ReplyDetectionResult = {
  is_reply: boolean;
  pipeline_id?: string;
  contact_email?: string;
};

/**
 * Detect if an incoming email is a reply to a Sales Closer outreach.
 * Matches by sender email against active pipeline records.
 *
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
    // Extract sender email from metadata
    const senderEmail = extractSenderEmail(record.metadata);
    if (!senderEmail) return { is_reply: false };

    // Check if this sender has an active pipeline record
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_email, stage, awaiting_reply")
      .eq("workspace_id", workspaceId)
      .eq("contact_email", senderEmail)
      .eq("awaiting_reply", true)
      .single();

    if (!pipeline) return { is_reply: false };

    console.log(
      `[reply-detector] Reply detected from ${senderEmail} for pipeline ${pipeline.id} (stage: ${pipeline.stage})`
    );

    // Fire Inngest event for the sales closer workflow to handle
    try {
      await inngest.send({
        name: "skyler/pipeline.reply.received",
        data: {
          pipelineId: pipeline.id,
          contactEmail: senderEmail,
          workspaceId,
          replyContent: record.content.slice(0, 3000), // Cap for event size
          stage: pipeline.stage,
        },
      });
      console.log(`[reply-detector] Fired skyler/pipeline.reply.received for pipeline ${pipeline.id}`);
    } catch (inngestErr) {
      console.error("[reply-detector] Inngest event failed:", inngestErr);
      // Don't throw — the detection still succeeded
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

/**
 * Extract sender email from record metadata.
 * Handles different metadata shapes from Gmail and Outlook normalizers.
 */
function extractSenderEmail(
  metadata?: Record<string, unknown>
): string | null {
  if (!metadata) return null;

  // Gmail messages: metadata.from or metadata.sender
  const from = metadata.from ?? metadata.sender ?? metadata.from_email;
  if (typeof from === "string") {
    // Could be "Name <email@example.com>" format
    const match = from.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : from.toLowerCase();
  }

  // Outlook emails: metadata.from may be an object { emailAddress: { address: "..." } }
  if (typeof from === "object" && from !== null) {
    const addr = (from as Record<string, unknown>).emailAddress;
    if (typeof addr === "object" && addr !== null) {
      const email = (addr as Record<string, unknown>).address;
      if (typeof email === "string") return email.toLowerCase();
    }
    // Or it could just be { address: "..." }
    const directAddr = (from as Record<string, unknown>).address;
    if (typeof directAddr === "string") return directAddr.toLowerCase();
  }

  return null;
}

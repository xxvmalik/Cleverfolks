/**
 * Slack notification sender for Skyler.
 * Uses Nango proxy to send messages via the connected Slack integration.
 * Never throws — logs errors and returns silently.
 */

import { Nango } from "@nangohq/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationEventType } from "./notifications";

type SlackNotificationPayload = {
  eventType: NotificationEventType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
};

const EVENT_EMOJI: Record<NotificationEventType, string> = {
  lead_replied: ":speech_balloon:",
  draft_awaiting_approval: ":memo:",
  lead_scored_hot: ":fire:",
  escalation_triggered: ":rotating_light:",
  deal_closed_won: ":tada:",
  deal_closed_lost: ":x:",
  objection_received: ":warning:",
  meeting_booked: ":calendar:",
  action_note_due: ":bell:",
  info_requested: ":raised_hand:",
  meeting_cancelled: ":no_entry_sign:",
  meeting_no_show: ":eyes:",
  meeting_rescheduled: ":arrows_counterclockwise:",
  new_attendee_detected: ":bust_in_silhouette:",
  pre_call_brief: ":clipboard:",
  health_signal: ":chart_with_downwards_trend:",
};

/**
 * Send a notification to a Slack channel or user via Nango proxy.
 * @param channelOrUserId — A Slack channel ID (C...) or user ID (U...).
 *   For DMs to a user, Slack's chat.postMessage accepts a user ID directly.
 */
export async function sendSlackNotification(
  db: SupabaseClient,
  workspaceId: string,
  channelOrUserId: string,
  payload: SlackNotificationPayload
): Promise<void> {
  try {
    // Find the Slack Nango connection for this workspace
    const { data: integration } = await db
      .from("integrations")
      .select("nango_connection_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "slack")
      .eq("status", "connected")
      .maybeSingle();

    if (!integration?.nango_connection_id) {
      console.log("[slack-notify] No connected Slack integration — skipping");
      return;
    }

    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    const emoji = EVENT_EMOJI[payload.eventType] ?? ":bell:";

    // Build Slack Block Kit message for rich formatting
    const blocks: Array<Record<string, unknown>> = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} ${payload.title}`,
          emoji: true,
        },
      },
    ];

    if (payload.body) {
      // Convert markdown to Slack mrkdwn:
      // - ## headings → *bold* with newline
      // - **bold** → *bold* (Slack format)
      // - • bullets stay as-is (Slack renders them)
      // - Split into sections if body is long (Slack block text limit is 3000 chars)
      const slackBody = markdownToSlackMrkdwn(payload.body);

      // Split into chunks of max 3000 chars at section boundaries
      const chunks = splitIntoChunks(slackBody, 2900);
      for (const chunk of chunks) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: chunk,
          },
        });
      }
    }

    // Fallback text for notifications / non-block-compatible clients
    const fallbackText = `${emoji} ${payload.title}`;

    await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://slack.com",
      endpoint: "/api/chat.postMessage",
      connectionId: integration.nango_connection_id,
      providerConfigKey: "slack",
      data: {
        channel: channelOrUserId,
        text: fallbackText,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      },
    });

    console.log(`[slack-notify] Sent to ${channelOrUserId}: ${payload.title}`);
  } catch (err) {
    console.error(`[slack-notify] Failed to send to ${channelOrUserId}:`, err instanceof Error ? err.message : err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert markdown to Slack mrkdwn format */
function markdownToSlackMrkdwn(md: string): string {
  return md
    // ## Heading → *Heading* with blank line
    .replace(/^#{1,3}\s+(.+)$/gm, "\n*$1*")
    // **bold** → *bold*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    // Remove duplicate * from **already bold** → already handled
    // ⚠️ emoji shortcodes → Slack renders them natively
    // Clean up excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split text into chunks at paragraph/section boundaries */
function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Find the last double-newline before the limit
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt <= 0) {
      // Fall back to last single newline
      splitAt = remaining.lastIndexOf("\n", maxLen);
    }
    if (splitAt <= 0) {
      // Hard cut
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

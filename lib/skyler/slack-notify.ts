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
    const text = `${emoji} *${payload.title}*${payload.body ? `\n${payload.body}` : ""}`;

    await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://slack.com",
      endpoint: "/api/chat.postMessage",
      connectionId: integration.nango_connection_id,
      providerConfigKey: "slack",
      data: {
        channel: channelOrUserId,
        text,
        unfurl_links: false,
        unfurl_media: false,
      },
    });

    console.log(`[slack-notify] Sent to ${channelOrUserId}: ${payload.title}`);
  } catch (err) {
    console.error(`[slack-notify] Failed to send to ${channelOrUserId}:`, err instanceof Error ? err.message : err);
  }
}

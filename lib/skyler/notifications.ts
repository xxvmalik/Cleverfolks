/**
 * Skyler notification dispatcher.
 * Fan-out: in-app (always) + Slack + email based on workspace settings.
 * Fire-and-forget — never throws, never blocks the pipeline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSlackNotification } from "./slack-notify";
import { sendEmailNotification } from "./email-notify";

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "lead_replied"
  | "draft_awaiting_approval"
  | "lead_scored_hot"
  | "escalation_triggered"
  | "deal_closed_won"
  | "deal_closed_lost"
  | "objection_received"
  | "meeting_booked"
  | "action_note_due"
  | "info_requested"
  | "meeting_cancelled"
  | "meeting_no_show"
  | "meeting_rescheduled"
  | "new_attendee_detected"
  | "pre_call_brief"
  | "health_signal"
  | "reengagement_exhausted"
  | "reengagement_reply";

export type NotificationParams = {
  workspaceId: string;
  eventType: NotificationEventType;
  pipelineId?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
};

export type SlackTarget = {
  id: string;
  name: string;
  type: "channel" | "member";
};

type NotificationSettings = {
  slack: boolean;
  slackChannels?: SlackTarget[];
  slackChannel?: string; // legacy single channel (display name — deprecated)
  email: boolean;
  emailAddresses?: string[];
  emailAddress?: string; // legacy single address
  inApp?: boolean;
  taskCreation: boolean;
  taskAssignee: string;
};

type WorkflowSettings = {
  autonomyLevel?: string;
  notifications?: NotificationSettings;
};

// Events that fire even in full autonomy mode — these always need human attention
const FULL_AUTONOMY_EVENTS: Set<NotificationEventType> = new Set([
  "escalation_triggered",
  "objection_received",
  "info_requested",
]);

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Dispatch a notification to all configured channels.
 * Never throws — logs errors and continues.
 */
export async function dispatchNotification(
  db: SupabaseClient,
  params: NotificationParams
): Promise<void> {
  const { workspaceId, eventType, pipelineId, title, body, metadata } = params;

  try {
    // 1. Load workflow settings
    const { data: ws } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();

    const settings = (ws?.settings ?? {}) as Record<string, unknown>;
    const workflow = (settings.skyler_workflow ?? {}) as WorkflowSettings;
    const notifications = workflow.notifications ?? {} as NotificationSettings;
    const autonomyLevel = workflow.autonomyLevel ?? "draft_approve";

    // 2. Check autonomy filter — in full autonomy, only escalation/objection events fire
    if (autonomyLevel === "full_autonomy" && !FULL_AUTONOMY_EVENTS.has(eventType)) {
      console.log(`[notifications] Skipping ${eventType} — full autonomy mode`);
      return;
    }

    // 3. Deduplicate — skip if same event_type + pipeline_id exists within the last hour
    if (pipelineId) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: existing } = await db
        .from("skyler_notifications")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .eq("event_type", eventType)
        .gte("created_at", oneHourAgo)
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.log(`[notifications] Skipping duplicate ${eventType} for pipeline ${pipelineId}`);
        return;
      }
    }

    // 4. Always save to in-app notifications
    try {
      await db.from("skyler_notifications").insert({
        workspace_id: workspaceId,
        pipeline_id: pipelineId ?? null,
        event_type: eventType,
        title,
        body: body ?? null,
        metadata: metadata ?? {},
        read: false,
      });
      console.log(`[notifications] In-app: ${eventType} — ${title}`);
    } catch (inAppErr) {
      console.error("[notifications] In-app insert failed:", inAppErr);
    }

    // 4. Slack notifications
    if (notifications.slack) {
      const targets = resolveSlackTargets(notifications);
      if (targets.length > 0) {
        for (const target of targets) {
          try {
            await sendSlackNotification(db, workspaceId, target.id, {
              eventType,
              title,
              body,
              metadata,
            });
          } catch (slackErr) {
            console.error(`[notifications] Slack send to ${target.name} (${target.id}) failed:`, slackErr);
          }
        }
      }
    }

    // 5. Email notifications
    if (notifications.email) {
      const emails = resolveEmailAddresses(notifications);
      if (emails.length > 0) {
        for (const email of emails) {
          try {
            await sendEmailNotification(email, {
              eventType,
              title,
              body,
              metadata,
            });
          } catch (emailErr) {
            console.error(`[notifications] Email send to ${email} failed:`, emailErr);
          }
        }
      }
    }

    console.log(`[notifications] Dispatched ${eventType} for workspace ${workspaceId}`);
  } catch (err) {
    // Never throw — notification failures must not block the pipeline
    console.error("[notifications] Dispatch failed:", err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve Slack targets — supports new object format and legacy string format. */
function resolveSlackTargets(notifications: NotificationSettings): SlackTarget[] {
  // New format: slackChannels array of { id, name, type } objects (up to 3)
  if (notifications.slackChannels && notifications.slackChannels.length > 0) {
    return notifications.slackChannels
      .filter((t) => t && t.id)
      .slice(0, 3);
  }
  // Legacy format: single slackChannel string — try to use if it looks like a Slack ID
  if (notifications.slackChannel?.trim()) {
    const raw = notifications.slackChannel.trim();
    // Slack IDs start with C (channel), D (DM), G (group), or U (user)
    if (/^[CDGU][A-Z0-9]{8,}$/.test(raw)) {
      return [{ id: raw, name: raw, type: "channel" }];
    }
    console.warn(`[notifications] Legacy slackChannel "${raw}" is not a valid Slack ID. Update notification settings to use the channel picker.`);
  }
  return [];
}

/** Resolve email addresses — supports both new multi-email and legacy single-email formats. */
function resolveEmailAddresses(notifications: NotificationSettings): string[] {
  // New format: emailAddresses array (up to 3)
  if (notifications.emailAddresses && notifications.emailAddresses.length > 0) {
    return notifications.emailAddresses.filter(Boolean).slice(0, 3);
  }
  // Legacy format: single emailAddress string
  if (notifications.emailAddress?.trim()) {
    return [notifications.emailAddress.trim()];
  }
  return [];
}

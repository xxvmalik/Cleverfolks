/**
 * Email notification sender for Skyler.
 * Uses Resend to send transactional alerts to workspace users.
 * Never throws — logs errors and returns silently.
 */

import { Resend } from "resend";
import type { NotificationEventType } from "./notifications";

type EmailNotificationPayload = {
  eventType: NotificationEventType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
};

const EVENT_LABELS: Record<NotificationEventType, string> = {
  lead_replied: "Lead Replied",
  draft_awaiting_approval: "Draft Awaiting Approval",
  lead_scored_hot: "Hot Lead Detected",
  escalation_triggered: "Escalation Triggered",
  deal_closed_won: "Deal Closed Won",
  deal_closed_lost: "Deal Closed Lost",
  objection_received: "Objection Received",
  meeting_booked: "Meeting Booked",
};

/**
 * Send a notification email to a workspace user.
 */
export async function sendEmailNotification(
  toEmail: string,
  payload: EmailNotificationPayload
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email-notify] RESEND_API_KEY not set — skipping email notification");
    return;
  }

  try {
    const resend = new Resend(apiKey);
    const label = EVENT_LABELS[payload.eventType] ?? "Notification";
    const contactName = (payload.metadata?.contactName as string) ?? "";
    const companyName = (payload.metadata?.companyName as string) ?? "";
    const leadInfo = contactName ? ` — ${contactName}${companyName ? ` at ${companyName}` : ""}` : "";

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <div style="background: #131619; border-radius: 12px; padding: 24px; color: #fff;">
          <h2 style="margin: 0 0 8px; font-size: 18px; color: #3A89FF;">${label}${leadInfo}</h2>
          <p style="margin: 0 0 16px; font-size: 15px; color: #fff;">${payload.title}</p>
          ${payload.body ? `<p style="margin: 0; font-size: 14px; color: #8B8F97;">${payload.body}</p>` : ""}
        </div>
        <p style="margin: 16px 0 0; font-size: 12px; color: #8B8F97; text-align: center;">
          Sent by Skyler, your AI Sales Employee — CleverFolks
        </p>
      </div>
    `;

    await resend.emails.send({
      from: "Skyler <notifications@cleverfolks.ai>",
      to: toEmail,
      subject: `Skyler: ${label}${leadInfo}`,
      html: htmlBody,
    });

    console.log(`[email-notify] Sent to ${toEmail}: ${label}`);
  } catch (err) {
    console.error(`[email-notify] Failed to send to ${toEmail}:`, err instanceof Error ? err.message : err);
  }
}

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
  action_note_due: "Action Note Due",
  info_requested: "Information Requested",
  meeting_cancelled: "Meeting Cancelled",
  meeting_no_show: "No-Show Detected",
  meeting_rescheduled: "Meeting Rescheduled",
  new_attendee_detected: "New Attendee Detected",
  pre_call_brief: "Pre-Call Brief",
  health_signal: "Meeting Health Signal",
  reengagement_exhausted: "Re-Engagement Exhausted",
  reengagement_reply: "Re-Engagement Reply Received",
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

    const bodyHtml = payload.body ? markdownToHtml(payload.body) : "";

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: #131619; border-radius: 12px; padding: 24px 28px; color: #fff;">
          <h2 style="margin: 0 0 16px; font-size: 18px; color: #3A89FF; border-bottom: 1px solid #2A2D35; padding-bottom: 12px;">${label}${leadInfo}</h2>
          <p style="margin: 0 0 16px; font-size: 15px; color: #fff; line-height: 1.5;">${escapeHtml(payload.title)}</p>
          ${bodyHtml ? `<div style="font-size: 14px; color: #D1D5DB; line-height: 1.7;">${bodyHtml}</div>` : ""}
        </div>
        <p style="margin: 16px 0 0; font-size: 12px; color: #8B8F97; text-align: center;">
          Sent by Skyler, your AI Sales Employee — CleverFolks
        </p>
      </div>
    `;

    await resend.emails.send({
      from: "Skyler <skyler@cleverfolks.app>",
      to: toEmail,
      subject: `Skyler: ${label}${leadInfo}`,
      html: htmlBody,
    });

    console.log(`[email-notify] Sent to ${toEmail}: ${label}`);
  } catch (err) {
    console.error(`[email-notify] Failed to send to ${toEmail}:`, err instanceof Error ? err.message : err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert markdown text to styled HTML for emails */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const htmlLines: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line — close list if open, add spacing
    if (!trimmed) {
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      continue;
    }

    // ## Heading
    const h2Match = trimmed.match(/^#{1,2}\s+(.+)$/);
    if (h2Match) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      htmlLines.push(`<h3 style="margin: 20px 0 8px; font-size: 15px; color: #3A89FF; font-weight: 600;">${escapeHtml(formatInline(h2Match[1]))}</h3>`);
      continue;
    }

    // ### Sub-heading
    const h3Match = trimmed.match(/^#{3}\s+(.+)$/);
    if (h3Match) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      htmlLines.push(`<h4 style="margin: 16px 0 6px; font-size: 14px; color: #8B8F97; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(formatInline(h3Match[1]))}</h4>`);
      continue;
    }

    // Bullet: •, -, or *
    const bulletMatch = trimmed.match(/^[•\-\*]\s+(.+)$/);
    if (bulletMatch) {
      if (!inList) {
        htmlLines.push('<ul style="margin: 4px 0 12px 8px; padding-left: 16px; list-style: none;">');
        inList = true;
      }
      htmlLines.push(`<li style="margin: 4px 0; padding-left: 4px; position: relative;">${formatInline(escapeHtml(bulletMatch[1]))}</li>`);
      continue;
    }

    // Numbered list: 1. 2. etc
    const numMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numMatch) {
      if (!inList) {
        htmlLines.push('<ul style="margin: 4px 0 12px 8px; padding-left: 16px; list-style: none;">');
        inList = true;
      }
      htmlLines.push(`<li style="margin: 4px 0; padding-left: 4px;">${formatInline(escapeHtml(numMatch[1]))}</li>`);
      continue;
    }

    // Regular paragraph
    if (inList) { htmlLines.push("</ul>"); inList = false; }
    htmlLines.push(`<p style="margin: 8px 0; line-height: 1.6;">${formatInline(escapeHtml(trimmed))}</p>`);
  }

  if (inList) htmlLines.push("</ul>");
  return htmlLines.join("\n");
}

/** Format inline markdown: **bold**, *italic*, `code` */
function formatInline(text: string): string {
  return text
    // **bold** → <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color: #fff;">$1</strong>')
    // *italic* (but not already handled bold)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    // `code` → styled span
    .replace(/`(.+?)`/g, '<code style="background: #2A2D35; padding: 1px 5px; border-radius: 3px; font-size: 13px;">$1</code>')
    // :emoji: → strip colons (email clients don't render Slack emoji codes)
    .replace(/:([a-z_]+):/g, "");
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Lightweight reply checker for Skyler Sales Closer.
 *
 * Runs every 5 minutes via cron. Bypasses the full Nango sync pipeline.
 * For each workspace with active pipeline records, queries the email provider
 * directly (via Nango proxy) for recent emails from pipeline contacts.
 * If a new reply is found, fires the same reply detection flow.
 *
 * This cuts reply detection from ~40 min (Nango 15-min sync + 15-min dedup)
 * down to ~5 minutes.
 */

import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { detectPipelineReply } from "@/lib/sync/reply-detector";

// ── Cron: Reply Check ───────────────────────────────────────────────────────

export const replyCheckScheduler = inngest.createFunction(
  {
    id: "reply-check-scheduler",
    retries: 1,
  },
  { cron: "*/5 * * * *" }, // Every 5 minutes
  async ({ step }) => {
    // Step 1: Find workspaces with active pipeline records awaiting replies
    const workspaces = await step.run("find-active-workspaces", async () => {
      const db = createAdminSupabaseClient();

      // Get distinct workspace IDs that have unresolved pipeline records
      const { data, error } = await db
        .from("skyler_sales_pipeline")
        .select("workspace_id")
        .is("resolution", null)
        .eq("awaiting_reply", true)
        .limit(100);

      if (error || !data) return [];

      // Deduplicate workspace IDs
      const unique = [...new Set(data.map((r) => r.workspace_id as string))];
      console.log(`[reply-check] Found ${unique.length} workspaces with active pipelines`);
      return unique;
    });

    if (workspaces.length === 0) return { checked: 0, replies: 0 };

    // Step 2: For each workspace, check for new emails from pipeline contacts
    let totalReplies = 0;

    for (const workspaceId of workspaces) {
      const replies = await step.run(`check-workspace-${workspaceId.slice(0, 8)}`, async () => {
        return await checkWorkspaceReplies(workspaceId);
      });
      totalReplies += replies;
    }

    console.log(`[reply-check] Done. Checked ${workspaces.length} workspaces, found ${totalReplies} new replies`);
    return { checked: workspaces.length, replies: totalReplies };
  }
);

// ── Core logic ──────────────────────────────────────────────────────────────

async function checkWorkspaceReplies(workspaceId: string): Promise<number> {
  const db = createAdminSupabaseClient();

  // Get the email provider connection for this workspace
  const { data: integration } = await db
    .from("integrations")
    .select("provider, nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", ["google-mail", "outlook"])
    .maybeSingle();

  if (!integration?.nango_connection_id) return 0;

  // Get active pipeline contacts for this workspace
  const { data: pipelines } = await db
    .from("skyler_sales_pipeline")
    .select("contact_email")
    .eq("workspace_id", workspaceId)
    .is("resolution", null)
    .eq("awaiting_reply", true)
    .limit(50);

  if (!pipelines || pipelines.length === 0) return 0;

  const contactEmails = pipelines.map((p) => (p.contact_email as string).toLowerCase());
  console.log(`[reply-check] Workspace ${workspaceId.slice(0, 8)}: checking ${contactEmails.length} contacts via ${integration.provider}`);

  // Query the email provider for recent emails from these contacts
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  let repliesFound = 0;

  try {
    if (integration.provider === "outlook") {
      repliesFound = await checkOutlookReplies(
        nango,
        integration.nango_connection_id,
        contactEmails,
        workspaceId,
        db
      );
    } else if (integration.provider === "google-mail") {
      repliesFound = await checkGmailReplies(
        nango,
        integration.nango_connection_id,
        contactEmails,
        workspaceId,
        db
      );
    }
  } catch (err) {
    console.error(`[reply-check] Error checking ${integration.provider}:`, err instanceof Error ? err.message : err);
  }

  return repliesFound;
}

// ── Outlook check ───────────────────────────────────────────────────────────

async function checkOutlookReplies(
  nango: Nango,
  connectionId: string,
  contactEmails: string[],
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<number> {
  let repliesFound = 0;

  // Fetch top 20 recent emails and filter client-side.
  // Note: $filter with receivedDateTime doesn't work reliably through Nango proxy,
  // so we fetch recent messages without a date filter and check timestamps ourselves.
  const tenMinAgo = Date.now() - 10 * 60 * 1000;

  try {
    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,body,receivedDateTime`,
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (response as any)?.data?.value;
    if (!messages || messages.length === 0) return 0;

    for (const msg of messages) {
      // Client-side time filter: skip emails older than 10 minutes
      const receivedAt = new Date(msg.receivedDateTime).getTime();
      if (receivedAt < tenMinAgo) continue;

      const senderEmail = msg.from?.emailAddress?.address?.toLowerCase();
      if (!senderEmail || !contactEmails.includes(senderEmail)) continue;

      // Skip calendar acceptance/decline notifications — not real replies
      const subject = (msg.subject ?? "") as string;
      if (/^(Accepted|Tentative|Declined|Cancelled|Updated):/i.test(subject)) {
        continue;
      }

      // Found a recent email from a pipeline contact — run reply detection
      const content = buildEmailContent(msg);

      const result = await detectPipelineReply(db, workspaceId, {
        content,
        metadata: {
          from: { emailAddress: { address: senderEmail } },
          subject: msg.subject,
          receivedDateTime: msg.receivedDateTime,
          outlook_message_id: msg.id,
        },
      });

      if (result.is_reply) {
        repliesFound++;
        console.log(`[reply-check] New Outlook reply detected → pipeline ${result.pipeline_id}`);
      }
    }
  } catch (err) {
    console.error("[reply-check] Outlook query failed:", err instanceof Error ? err.message : err);
  }

  return repliesFound;
}

// ── Gmail check ─────────────────────────────────────────────────────────────

async function checkGmailReplies(
  nango: Nango,
  connectionId: string,
  contactEmails: string[],
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<number> {
  let repliesFound = 0;

  // Search Gmail for recent emails from pipeline contacts
  // Gmail search supports OR and from: operators
  // Batch into groups of 10 to stay within Gmail query length limits
  const BATCH_SIZE = 10;
  const batches: string[][] = [];
  for (let i = 0; i < contactEmails.length; i += BATCH_SIZE) {
    batches.push(contactEmails.slice(i, i + BATCH_SIZE));
  }

  // Collect all message IDs from all batches, dedup by ID
  const seenMessageIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMessages: Array<{ id: string }> = [];

  try {
    for (const batch of batches) {
      const fromQuery = batch.map((e) => `from:${e}`).join(" OR ");
      const query = `${fromQuery} newer_than:10m`;

      const searchResponse = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://gmail.googleapis.com",
        endpoint: `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
        connectionId,
        providerConfigKey: "google-mail",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messageList = (searchResponse as any)?.data?.messages;
      if (messageList) {
        for (const m of messageList) {
          if (!seenMessageIds.has(m.id)) {
            seenMessageIds.add(m.id);
            allMessages.push(m);
          }
        }
      }
    }

    if (allMessages.length === 0) return 0;
    const messageList = allMessages;

    // Step 2: Fetch each message's details
    for (const item of messageList) {
      try {
        const msgResponse = await nango.proxy({
          method: "GET",
          baseUrlOverride: "https://gmail.googleapis.com",
          endpoint: `/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          connectionId,
          providerConfigKey: "google-mail",
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (msgResponse as any)?.data;
        if (!msg) continue;

        const headers = (msg.payload?.headers ?? []) as Array<{ name: string; value: string }>;
        const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
        const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";

        // Extract email from "Name <email>" format
        const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([^\s]+@[^\s]+)/);
        const senderEmail = emailMatch ? emailMatch[1].toLowerCase() : fromHeader.toLowerCase();

        if (!contactEmails.includes(senderEmail)) continue;

        // Skip calendar acceptance/decline notifications
        if (/^(Accepted|Tentative|Declined|Cancelled|Updated):/i.test(subject)) {
          continue;
        }

        // Fetch the snippet as content
        const content = `From: ${fromHeader}\nSubject: ${subject}\n\n${msg.snippet ?? ""}`;

        const result = await detectPipelineReply(db, workspaceId, {
          content,
          metadata: {
            from: fromHeader,
            subject,
            gmail_message_id: msg.id,
          },
        });

        if (result.is_reply) {
          repliesFound++;
          console.log(`[reply-check] New Gmail reply detected → pipeline ${result.pipeline_id}`);
        }
      } catch (msgErr) {
        console.error(`[reply-check] Gmail message fetch failed:`, msgErr instanceof Error ? msgErr.message : msgErr);
      }
    }
  } catch (err) {
    console.error("[reply-check] Gmail search failed:", err instanceof Error ? err.message : err);
  }

  return repliesFound;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEmailContent(outlookMessage: any): string {
  const from = outlookMessage.from?.emailAddress?.address ?? "unknown";
  const fromName = outlookMessage.from?.emailAddress?.name ?? "";
  const subject = outlookMessage.subject ?? "";
  const body = outlookMessage.body?.content
    ? stripHtml(outlookMessage.body.content)
    : outlookMessage.bodyPreview ?? "";

  return `From: ${fromName ? `${fromName} <${from}>` : from}\nSubject: ${subject}\n\n${body}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

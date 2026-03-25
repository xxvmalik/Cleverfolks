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
    // Step 1: Find workspaces with any pipeline records that could receive replies.
    // Don't filter on awaiting_reply — the cadence sets it to false in several
    // legitimate scenarios (pending approval, no_response) but the contact can
    // still reply. The detectPipelineReply dedup (last_reply_at lock) prevents
    // duplicate processing, so casting a wide net here is safe.
    const workspaces = await step.run("find-active-workspaces", async () => {
      const db = createAdminSupabaseClient();

      // Unresolved leads (active outreach)
      const { data: unresolved } = await db
        .from("skyler_sales_pipeline")
        .select("workspace_id")
        .is("resolution", null)
        .limit(100);

      // Engaged/no_response leads — can still receive replies
      const { data: engaged } = await db
        .from("skyler_sales_pipeline")
        .select("workspace_id")
        .in("resolution", ["meeting_booked", "demo_booked", "no_response"])
        .limit(100);

      const allRows = [...(unresolved ?? []), ...(engaged ?? [])];
      if (allRows.length === 0) return [];

      // Deduplicate workspace IDs
      const unique = [...new Set(allRows.map((r) => r.workspace_id as string))];
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

  // Get ALL pipeline contacts that could reply — don't filter on awaiting_reply.
  // The cadence sets awaiting_reply=false in several cases (pending approval,
  // no_response) but the contact can still reply. detectPipelineReply handles dedup.
  const { data: unresolvedContacts } = await db
    .from("skyler_sales_pipeline")
    .select("contact_email")
    .eq("workspace_id", workspaceId)
    .is("resolution", null)
    .limit(100);

  const { data: engagedContacts } = await db
    .from("skyler_sales_pipeline")
    .select("contact_email")
    .eq("workspace_id", workspaceId)
    .in("resolution", ["meeting_booked", "demo_booked", "no_response"])
    .limit(100);

  const pipelines = [...(unresolvedContacts ?? []), ...(engagedContacts ?? [])];

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

/**
 * Extract a valid SMTP email from an Outlook message's `from` field.
 * Microsoft Graph sometimes returns X500 addresses (/o=exchangelabs/...)
 * instead of SMTP emails — skip those since we can't match them.
 */
function extractOutlookSender(msg: { from?: { emailAddress?: { address?: string } } }): string | null {
  const raw = msg.from?.emailAddress?.address;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // X500/Exchange internal addresses start with /o= and don't contain @
  if (lower.startsWith("/o=") || !lower.includes("@")) return null;
  return lower;
}

async function checkOutlookReplies(
  nango: Nango,
  connectionId: string,
  contactEmails: string[],
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<number> {
  let repliesFound = 0;

  // Query INBOX only — /v1.0/me/messages returns Sent Items too, which fills
  // the top results with Skyler's own outreach and buries actual replies.
  // Use a 24-hour window so replies aren't missed if cron cycles skip or
  // contact wasn't in the check list during earlier cycles. The
  // detectPipelineReply dedup (last_reply_at 5-min lock) prevents duplicates.
  const windowStart = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/mailFolders/Inbox/messages?$top=30&$orderby=receivedDateTime desc&$select=id,from,toRecipients,subject,bodyPreview,body,receivedDateTime`,
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (response as any)?.data?.value;
    console.log(`[reply-check] Outlook returned ${messages?.length ?? 0} messages`);
    if (!messages || messages.length === 0) return 0;

    for (const msg of messages) {
      // Client-side time filter: skip emails older than 24 hours
      const receivedAt = new Date(msg.receivedDateTime).getTime();
      if (receivedAt < windowStart) {
        continue;
      }

      // Extract sender, skipping X500/Exchange internal addresses
      const senderEmail = extractOutlookSender(msg);
      if (!senderEmail) continue;
      if (!contactEmails.includes(senderEmail)) continue;

      // Skip calendar acceptance/decline notifications — not real replies
      const subject = (msg.subject ?? "") as string;
      if (/^(Accepted|Tentative|Declined|Cancelled|Updated):/i.test(subject)) {
        continue;
      }

      console.log(`[reply-check] Processing email from ${senderEmail}: "${subject}"`);

      // Found a recent email from a pipeline contact — run reply detection
      const content = buildEmailContent(msg);

      try {
        const result = await detectPipelineReply(db, workspaceId, {
          content,
          metadata: {
            from: { emailAddress: { address: senderEmail } },
            toRecipients: msg.toRecipients ?? [],
            subject: msg.subject,
            receivedDateTime: msg.receivedDateTime,
            outlook_message_id: msg.id,
          },
        });

        console.log(`[reply-check] detectPipelineReply result for ${senderEmail}: is_reply=${result.is_reply}, pipeline=${result.pipeline_id ?? "none"}`);

        if (result.is_reply) {
          repliesFound++;
          console.log(`[reply-check] New Outlook reply detected → pipeline ${result.pipeline_id}`);
        }
      } catch (detectErr) {
        console.error(`[reply-check] detectPipelineReply threw for ${senderEmail}:`, detectErr instanceof Error ? detectErr.message : detectErr);
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
      // Gmail newer_than units: d=days, m=months (no minutes unit)
      const query = `${fromQuery} newer_than:1d`;

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

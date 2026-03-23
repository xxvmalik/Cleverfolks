/**
 * Email sender for Skyler Sales Closer.
 * Sends through the user's connected Gmail or Outlook via Nango proxy.
 * Drafts are stored in skyler_actions for user approval.
 * Actual sending only happens when the user approves.
 */

import { Nango } from "@nangohq/node";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateTrackingPixel } from "@/lib/skyler/open-tracking";

export type EmailDraftParams = {
  workspaceId: string;
  pipelineId: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  replyTo?: string;
  fromName?: string;
};

// Default follow-up cadence — delay_days is relative to the PREVIOUS step's send.
// After step 1: wait 3d → step 2. After step 2: wait 4d → step 3. After step 3: wait 7d → step 4.
export const DEFAULT_CADENCE = [
  { step: 1, delay_days: 0, angle: "initial_outreach" as const },
  { step: 2, delay_days: 3, angle: "different_value_prop" as const },
  { step: 3, delay_days: 4, angle: "social_proof_or_case_study" as const },
  { step: 4, delay_days: 7, angle: "breakup_final_attempt" as const },
];

export const SALES_CLOSER_DEFAULTS = {
  cadence: DEFAULT_CADENCE,
  hot_threshold: 70,
  approval_required: true,
  max_emails_per_lead: 4,
  research_cache_days: 7,
  voice_refresh_days: 30,
};

/**
 * Store an email draft as a pending skyler_action for user approval.
 * Does NOT send the email.
 */
export async function draftOutreachEmail(
  db: SupabaseClient,
  params: EmailDraftParams
): Promise<{ actionId: string }> {
  // Auto-populate fromName from workspace owner profile + company name if not provided
  let fromName = params.fromName ?? null;
  if (!fromName) {
    try {
      const { data: membership } = await db
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", params.workspaceId)
        .eq("role", "owner")
        .maybeSingle();
      if (membership?.user_id) {
        const { data: profile } = await db
          .from("profiles")
          .select("full_name")
          .eq("id", membership.user_id)
          .maybeSingle();
        const { data: ws } = await db
          .from("workspaces")
          .select("name, settings")
          .eq("id", params.workspaceId)
          .maybeSingle();
        const companyName = (ws?.settings as Record<string, unknown>)?.business_profile
          ? ((ws?.settings as Record<string, Record<string, string>>)?.business_profile?.company_name)
          : ws?.name;
        const ownerName = profile?.full_name;
        if (ownerName && companyName) {
          fromName = `${ownerName}, ${companyName}`;
        } else if (ownerName) {
          fromName = ownerName;
        }
      }
    } catch {
      // Non-critical — proceed without fromName
    }
  }

  const description = `Send outreach email to ${params.to}: "${params.subject}"`;

  const { data, error } = await db
    .from("skyler_actions")
    .insert({
      workspace_id: params.workspaceId,
      pipeline_id: params.pipelineId,
      tool_name: "send_email",
      tool_input: {
        to: params.to,
        subject: params.subject,
        htmlBody: params.htmlBody,
        textBody: params.textBody,
        replyTo: params.replyTo ?? null,
        fromName,
        pipelineId: params.pipelineId,
      },
      description,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to store email draft: ${error?.message ?? "unknown error"}`);
  }

  console.log(`[email-sender] Email draft stored for approval: ${data.id}`);
  return { actionId: data.id };
}

// ── Provider detection ──────────────────────────────────────────────────────

type EmailProvider = "google-mail" | "outlook";

async function getEmailProvider(
  db: SupabaseClient,
  workspaceId: string
): Promise<{ provider: EmailProvider; connectionId: string } | null> {
  // Check for connected Gmail or Outlook integration
  const { data: integrations } = await db
    .from("integrations")
    .select("provider, nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", ["google-mail", "outlook"]);

  if (!integrations || integrations.length === 0) return null;

  // Prefer Outlook, fall back to Gmail
  const outlook = integrations.find((i) => i.provider === "outlook");
  if (outlook?.nango_connection_id) {
    return { provider: "outlook", connectionId: outlook.nango_connection_id };
  }

  const gmail = integrations.find((i) => i.provider === "google-mail");
  if (gmail?.nango_connection_id) {
    return { provider: "google-mail", connectionId: gmail.nango_connection_id };
  }

  return null;
}

async function getUserEmail(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  // Get the workspace owner's email from profiles via membership
  const { data } = await db
    .from("workspace_memberships")
    .select("profiles(email)")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = (data as any)?.profiles;
  return Array.isArray(profile) ? profile[0]?.email : profile?.email ?? null;
}

// ── Threading helpers ────────────────────────────────────────────────────────

type ThreadingInfo = {
  inReplyTo: string | null;
  references: string[];
  originalSubject: string | null;
  isReplyThread: boolean;
  /** The last stored Outlook message ID from the thread — used for direct createReply (no search needed) */
  lastOutlookMessageId: string | null;
};

function getThreadingInfo(thread: Array<Record<string, unknown>>): ThreadingInfo {
  const messageIds: string[] = [];
  let originalSubject: string | null = null;
  let hasProspectReply = false;
  let lastOutlookMessageId: string | null = null;

  for (const entry of thread) {
    if (entry.internet_message_id) {
      messageIds.push(entry.internet_message_id as string);
    }
    if (!originalSubject && entry.subject && entry.role === "skyler") {
      originalSubject = entry.subject as string;
    }
    if (entry.role === "prospect" || entry.role === "contact") {
      hasProspectReply = true;
    }
    // Track the most recent Outlook message ID (from either side)
    if (entry.outlook_message_id) {
      lastOutlookMessageId = entry.outlook_message_id as string;
    }
  }

  return {
    inReplyTo: messageIds.length > 0 ? messageIds[messageIds.length - 1] : null,
    references: messageIds,
    originalSubject,
    isReplyThread: hasProspectReply,
    lastOutlookMessageId,
  };
}

/** Ensure reply subjects keep the "Re:" thread prefix. */
function enforceReplySubject(subject: string, originalSubject: string | null, isReply: boolean): string {
  if (!isReply || !originalSubject) return subject;
  // Strip any existing Re:/RE:/re: prefixes from the original for clean comparison
  const baseOriginal = originalSubject.replace(/^re:\s*/i, "").trim();
  const baseCurrent = subject.replace(/^re:\s*/i, "").trim();
  // If the AI already set the right Re: subject, keep it
  if (baseCurrent.toLowerCase() === baseOriginal.toLowerCase() && /^re:\s/i.test(subject)) {
    return subject;
  }
  // Force "Re: {original subject}"
  return `Re: ${baseOriginal}`;
}

// ── Gmail send ──────────────────────────────────────────────────────────────

async function sendViaGmail(params: {
  to: string;
  subject: string;
  htmlBody: string;
  fromEmail: string;
  fromName?: string | null;
  connectionId: string;
  inReplyTo?: string | null;
  references?: string[];
}): Promise<{ messageId: string; internetMessageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Generate a Message-ID for threading
  const domain = params.fromEmail.split("@")[1] ?? "cleverfolks.com";
  const generatedMessageId = `<${randomUUID()}@${domain}>`;

  // Build RFC 2822 email with threading headers
  const fromHeader = params.fromName
    ? `From: ${params.fromName.replace(/["\r\n]/g, "")} <${params.fromEmail}>`
    : `From: ${params.fromEmail}`;
  const headers: string[] = [
    fromHeader,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Message-ID: ${generatedMessageId}`,
  ];

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references && params.references.length > 0) {
    headers.push(`References: ${params.references.join(" ")}`);
  }

  const rawEmail = [...headers, "", params.htmlBody].join("\r\n");

  // Base64url encode (Gmail API requirement)
  const encodedEmail = Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await nango.proxy({
    method: "POST",
    baseUrlOverride: "https://gmail.googleapis.com",
    endpoint: "/gmail/v1/users/me/messages/send",
    connectionId: params.connectionId,
    providerConfigKey: "google-mail",
    data: { raw: encodedEmail },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messageId = (response as any)?.data?.id ?? "sent";
  console.log(`[email-sender] Gmail send success: ${messageId} (Message-ID: ${generatedMessageId})`);
  return { messageId, internetMessageId: generatedMessageId };
}

// ── Outlook send ────────────────────────────────────────────────────────────

/**
 * Send via Outlook using sendMail (primary) with draft→send as enhancement.
 *
 * sendMail only requires Mail.Send scope and is the most reliable approach.
 * We attempt draft→send first (which gives us the message ID for threading),
 * but fall back to sendMail if it fails (e.g. 403 due to missing Mail.ReadWrite scope).
 */
async function sendViaOutlook(params: {
  to: string;
  subject: string;
  htmlBody: string;
  fromEmail?: string | null;
  fromName?: string | null;
  connectionId: string;
}): Promise<{ messageId: string; outlookMessageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Quick-verify the Nango connection is alive before attempting to send
  try {
    await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: "/v1.0/me?$select=mail",
      connectionId: params.connectionId,
      providerConfigKey: "outlook",
    });
  } catch (verifyErr) {
    const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
    console.error(`[email-sender] Outlook connection verification failed:`, msg);
    throw new Error(`Outlook connection is broken or expired (${msg}). Please reconnect Outlook in Connectors.`);
  }

  // Build the `from` field if we have a display name.
  // Graph API requires Mail.Send.Shared to set `from` — if the account lacks
  // that scope the call returns 403, so we try with it and fall back without.
  const fromField = params.fromName && params.fromEmail
    ? { from: { emailAddress: { name: params.fromName.replace(/["\r\n]/g, ""), address: params.fromEmail } } }
    : {};

  // Draft→send is the PREFERRED path — it gives us a message ID needed for
  // createReply threading on follow-ups.  sendMail is a last resort because it
  // returns no ID and the Sent Items poll is unreliable (Exchange indexing lag).
  //
  // If the `from` field triggers 403 (missing Mail.Send.Shared), retry the draft
  // create WITHOUT `from` so we stay on the draft→send path.
  let draftId: string | null = null;
  for (const useFrom of [true, false]) {
    const extra = useFrom ? fromField : {};
    try {
      const draftResponse = await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: "/v1.0/me/messages",
        connectionId: params.connectionId,
        providerConfigKey: "outlook",
        data: {
          subject: params.subject,
          body: { contentType: "HTML", content: params.htmlBody },
          toRecipients: [{ emailAddress: { address: params.to } }],
          ...extra,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      draftId = (draftResponse as any)?.data?.id ?? null;
      if (draftId) break; // got a draft — proceed to send
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.response?.status ?? (err as any)?.status;
      const is403 = status === 403 || msg.includes("403");
      console.warn(`[email-sender] Draft create failed (useFrom=${useFrom}, status=${status}):`, msg);
      if (useFrom && Object.keys(fromField).length > 0 && is403) {
        console.warn(`[email-sender] Draft create 403 with from field — retrying without`);
        continue;
      }
      // Non-403 or already retried — fall through to sendMail
      break;
    }
  }

  if (draftId) {
    // Send the draft
    await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages/${draftId}/send`,
      connectionId: params.connectionId,
      providerConfigKey: "outlook",
      data: {},
    });

    console.log(`[email-sender] Outlook draft→send success (draft ID: ${draftId})`);

    // Draft ID becomes stale after send — recover the real Sent Items ID for threading
    const realSentId = await findSentMessageId(nango, params.connectionId, params.subject, params.to);
    const finalId = realSentId ?? draftId;
    if (realSentId) {
      console.log(`[email-sender] Recovered real Sent Items ID: ${realSentId}`);
    } else {
      console.warn(`[email-sender] Could not recover Sent Items ID — using draft ID (threading may break)`);
    }
    return { messageId: finalId, outlookMessageId: finalId };
  }

  // Last resort: sendMail — only requires Mail.Send scope but gives NO message ID.
  for (const useFrom of [true, false]) {
    const extra = useFrom ? fromField : {};
    try {
      await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: "/v1.0/me/sendMail",
        connectionId: params.connectionId,
        providerConfigKey: "outlook",
        data: {
          message: {
            subject: params.subject,
            body: { contentType: "HTML", content: params.htmlBody },
            toRecipients: [{ emailAddress: { address: params.to } }],
            ...extra,
          },
        },
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.response?.status ?? (err as any)?.status;
      const is403 = status === 403 || msg.includes("403");
      console.error(`[email-sender] sendMail failed (useFrom=${useFrom}, status=${status}):`, msg);
      if (useFrom && Object.keys(fromField).length > 0 && is403) {
        console.warn(`[email-sender] sendMail 403 with from field — retrying without`);
        continue;
      }
      if (!useFrom && is403) {
        throw new Error(`Outlook 403 on sendMail without from field — the OAuth token likely lacks Mail.Send scope. Please reconnect Outlook in Connectors and ensure mail permissions are granted.`);
      }
      throw err;
    }
  }

  // sendMail returns 202 with no body — poll Sent Items with longer delay for Exchange indexing
  const sentId = await findSentMessageId(nango, params.connectionId, params.subject, params.to);
  const messageId = sentId ?? `sendmail-${Date.now()}`;
  console.log(`[email-sender] Outlook sendMail success${sentId ? `: ${sentId}` : " (no ID recovered — threading may break for follow-ups)"}`);
  return { messageId, outlookMessageId: sentId ?? "" };
}

/** After sendMail, try to find the sent message ID for threading future replies. */
async function findSentMessageId(
  nango: Nango,
  connectionId: string,
  subject: string,
  to: string
): Promise<string | null> {
  const safeSubject = subject.replace(/'/g, "''").replace(/[\\"%&+#]/g, "");
  const filter = `subject eq '${safeSubject}'`;
  const qs = `$filter=${encodeURIComponent(filter)}&$top=1&$orderby=sentDateTime desc&$select=id`;

  // Poll Sent Items with increasing delays — Exchange indexing can take 1-3s.
  // Attempts: 0ms, 1s, 2s (total ~3s max wait).
  const delays = [0, 1000, 2000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));

      const response = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: `/v1.0/me/mailFolders/SentItems/messages?${qs}`,
        connectionId,
        providerConfigKey: "outlook",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = (response as any)?.data?.value;
      if (messages && messages.length > 0) {
        return messages[0].id;
      }
    } catch (err) {
      if (attempt === delays.length - 1) {
        console.warn(`[email-sender] Could not recover sent message ID after ${delays.length} attempts:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return null;
}

/**
 * Find the best Outlook message to reply to for proper threading on BOTH sides.
 *
 * Key insight: calling createReply on a Sent Items message creates a conversation
 * fork — the reply threads on the prospect's end but appears as a new thread on
 * the sender's Outlook. To thread on both sides, we must reply to a RECEIVED
 * message (e.g. a prospect reply in the Inbox).
 *
 * Strategy:
 *  1. Search all folders for the most recent received message in this thread (prospect reply)
 *  2. Fall back to Sent Items if no received message exists (first follow-up, no reply yet)
 */
async function findOutlookThreadMessage(
  nango: Nango,
  connectionId: string,
  subject: string,
  recipientEmail: string
): Promise<string | null> {
  // Escape for OData: single quotes doubled, strip any characters that break $filter
  const baseSubject = subject
    .replace(/^re:\s*/i, "")
    .trim()
    .replace(/'/g, "''")
    .replace(/[\\"%&+#]/g, ""); // Strip chars that break OData filters
  const safeEmail = recipientEmail.toLowerCase().replace(/'/g, "''");

  console.log(`[email-sender] Thread search for Outlook threading`);

  // Step 1: Search ALL folders for the most recent message FROM the prospect (received)
  try {
    const inboxFilter = `contains(subject,'${baseSubject}') and from/emailAddress/address eq '${safeEmail}'`;
    const inboxQs = `$filter=${encodeURIComponent(inboxFilter)}&$top=1&$orderby=receivedDateTime desc&$select=id,parentFolderId`;

    const inboxResponse = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages?${inboxQs}`,
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inboxMessages = (inboxResponse as any)?.data?.value;
    if (inboxMessages && inboxMessages.length > 0) {
      console.log(`[email-sender] Found received message for threading: ${inboxMessages[0].id} — reply will thread on both sides`);
      return inboxMessages[0].id;
    }

    console.log(`[email-sender] No received message found — falling back to Sent Items`);
  } catch (err) {
    console.warn(`[email-sender] Inbox search failed, falling back to Sent Items:`, err);
  }

  // Step 2: Fall back to Sent Items (for follow-ups before prospect has replied)
  try {
    const sentFilter = `contains(subject,'${baseSubject}') and toRecipients/any(r: r/emailAddress/address eq '${safeEmail}')`;
    const sentQs = `$filter=${encodeURIComponent(sentFilter)}&$top=1&$orderby=sentDateTime desc&$select=id`;

    const sentResponse = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/mailFolders/SentItems/messages?${sentQs}`,
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentMessages = (sentResponse as any)?.data?.value;
    if (sentMessages && sentMessages.length > 0) {
      console.log(`[email-sender] Found Sent Item for threading: ${sentMessages[0].id} (no received message available)`);
      return sentMessages[0].id;
    }

    console.log(`[email-sender] No Sent Item found for threading`);
  } catch (err) {
    console.warn(`[email-sender] Sent Items search failed:`, err);
  }

  return null;
}

/**
 * Attempt createReply on a specific Outlook message ID.
 * Returns the result if successful, null if createReply fails (does NOT send via fallback).
 * This allows the caller to try alternative message IDs before resorting to sendMail.
 */
async function tryCreateReply(params: {
  outlookMessageId: string;
  recipientEmail: string;
  subject: string;
  htmlBody: string;
  fromEmail?: string | null;
  fromName?: string | null;
  connectionId: string;
}): Promise<{ messageId: string; outlookMessageId: string } | null> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  try {
    const draftResponse = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages/${params.outlookMessageId}/createReply`,
      connectionId: params.connectionId,
      providerConfigKey: "outlook",
      data: {},
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftId = (draftResponse as any)?.data?.id;
    if (!draftId) return null;

    // Update the draft with our content, correct recipient, and sender display name.
    // Try with `from` first; if 403, retry without (Mail.Send.Shared not granted).
    const fromPatch = params.fromName && params.fromEmail
      ? { from: { emailAddress: { name: params.fromName.replace(/["\r\n]/g, ""), address: params.fromEmail } } }
      : {};
    for (const useFrom of [true, false]) {
      const extraFields = useFrom ? fromPatch : {};
      try {
        await nango.proxy({
          method: "PATCH",
          baseUrlOverride: "https://graph.microsoft.com",
          endpoint: `/v1.0/me/messages/${draftId}`,
          connectionId: params.connectionId,
          providerConfigKey: "outlook",
          data: {
            body: { contentType: "HTML", content: params.htmlBody },
            toRecipients: [{ emailAddress: { address: params.recipientEmail } }],
            ...extraFields,
          },
        });
        break; // success
      } catch (patchErr) {
        const status = (patchErr as Record<string, unknown>)?.status ?? (patchErr as { response?: { status?: number } })?.response?.status;
        const msg = patchErr instanceof Error ? patchErr.message : String(patchErr);
        if (useFrom && Object.keys(fromPatch).length > 0 && (status === 403 || msg.includes("403"))) {
          console.warn(`[email-sender] PATCH draft 403 with from field — retrying without`);
          continue;
        }
        throw patchErr;
      }
    }

    // Send the draft
    await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages/${draftId}/send`,
      connectionId: params.connectionId,
      providerConfigKey: "outlook",
      data: {},
    });

    console.log(`[email-sender] createReply success (draft ID: ${draftId}, thread from ${params.outlookMessageId})`);

    // Draft ID becomes stale after send — recover the real Sent Items ID
    const realId = await findSentMessageId(nango, params.connectionId, params.subject, params.recipientEmail);
    const finalId = realId ?? draftId;
    if (realId) {
      console.log(`[email-sender] Recovered real Sent Items ID: ${realId}`);
    } else {
      console.warn(`[email-sender] Could not recover Sent Items ID — using draft ID`);
    }
    return { messageId: finalId, outlookMessageId: finalId };
  } catch (err) {
    console.warn(`[email-sender] createReply on ${params.outlookMessageId} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Send a reply via Outlook sendMail (last resort fallback when createReply is unavailable).
 * Threading relies on "Re:" subject only — no conversationId inheritance.
 */
async function sendMailFallback(params: {
  recipientEmail: string;
  subject: string;
  htmlBody: string;
  fromEmail?: string | null;
  fromName?: string | null;
  connectionId: string;
}): Promise<{ messageId: string; outlookMessageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const replySubject = params.subject.startsWith("Re:") ? params.subject : `Re: ${params.subject}`;

  console.log(`[email-sender] sendMail fallback — threading via Re: subject only`);

  const fromField = params.fromName && params.fromEmail
    ? { from: { emailAddress: { name: params.fromName.replace(/["\r\n]/g, ""), address: params.fromEmail } } }
    : {};

  // Try with `from` display name; if 403, retry without.
  for (const useFrom of [true, false]) {
    const extraFields = useFrom ? fromField : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messagePayload: Record<string, any> = {
      subject: replySubject,
      body: { contentType: "HTML", content: params.htmlBody },
      toRecipients: [{ emailAddress: { address: params.recipientEmail } }],
      ...extraFields,
    };

    try {
      await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: "/v1.0/me/sendMail",
        connectionId: params.connectionId,
        providerConfigKey: "outlook",
        data: { message: messagePayload },
      });
      break; // success
    } catch (err) {
      const status = (err as Record<string, unknown>)?.status ?? (err as { response?: { status?: number } })?.response?.status;
      const msg = err instanceof Error ? err.message : String(err);
      if (useFrom && Object.keys(fromField).length > 0 && (status === 403 || msg.includes("403"))) {
        console.warn(`[email-sender] sendMailFallback 403 with from field — retrying without`);
        continue;
      }
      throw err;
    }
  }

  const sentId = await findSentMessageId(nango, params.connectionId, replySubject, params.recipientEmail);
  const messageId = sentId ?? `sendmail-reply-${Date.now()}`;

  console.log(`[email-sender] sendMail fallback success${sentId ? `: ${sentId}` : " (no ID recovered)"}`);
  return { messageId, outlookMessageId: sentId ?? "" };
}

// ── Execute approved send ───────────────────────────────────────────────────

/**
 * Execute an approved email send via the user's connected Gmail or Outlook.
 * Called ONLY when the user approves the pending action.
 */
export async function executeEmailSend(
  db: SupabaseClient,
  actionId: string
): Promise<{ messageId: string }> {
  // Load the pending action
  const { data: action, error: fetchErr } = await db
    .from("skyler_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !action) {
    throw new Error("Email action not found or already processed");
  }

  const input = action.tool_input as Record<string, unknown>;
  const pipelineId = input.pipelineId as string;
  const workspaceId = action.workspace_id as string;

  // Detect connected email provider
  const emailProvider = await getEmailProvider(db, workspaceId);
  if (!emailProvider) {
    await db
      .from("skyler_actions")
      .update({
        status: "failed",
        result: { last_error: "No email provider connected", failed_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    throw new Error("No email provider connected. Connect Gmail or Outlook in Integrations to send emails.");
  }

  // Get sender's email address
  const fromEmail = await getUserEmail(db, workspaceId);
  if (!fromEmail) {
    throw new Error("Could not determine sender email address");
  }

  // Extract threading info from existing conversation
  const { data: pipelineForThread } = await db
    .from("skyler_sales_pipeline")
    .select("conversation_thread, cadence_step")
    .eq("id", pipelineId)
    .single();

  const existingThread = (pipelineForThread?.conversation_thread ?? []) as Array<Record<string, unknown>>;
  const threading = getThreadingInfo(existingThread);

  // Enforce "Re:" subject for reply threads (prospect has replied)
  const rawSubject = input.subject as string;
  const subject = enforceReplySubject(rawSubject, threading.originalSubject, threading.isReplyThread);

  // ── Open tracking pixel ──────────────────────────────────────────────────
  const currentStep = ((pipelineForThread as Record<string, unknown>)?.cadence_step as number ?? 0) + 1;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://cleverfolks.vercel.app");
  const { trackingId, pixelHtml } = generateTrackingPixel(baseUrl, {
    pipelineId,
    workspaceId,
    cadenceStep: currentStep,
  });

  // Append tracking pixel to email HTML body
  const htmlBodyWithPixel = (input.htmlBody as string) + pixelHtml;

  // Send through the connected provider with threading headers
  let messageId: string;
  let internetMessageId: string | null = null;
  let outlookMessageId: string | null = null;
  try {
    if (emailProvider.provider === "google-mail") {
      const result = await sendViaGmail({
        to: input.to as string,
        subject,
        htmlBody: htmlBodyWithPixel,
        fromEmail,
        fromName: (input.fromName as string | undefined) ?? null,
        connectionId: emailProvider.connectionId,
        inReplyTo: threading.inReplyTo,
        references: threading.references,
      });
      messageId = result.messageId;
      internetMessageId = result.internetMessageId;
    } else if (existingThread.length > 0) {
      // Outlook follow-up — use stored ID first, fall back to search
      const storedId: string | null = threading.lastOutlookMessageId;
      const nangoThread = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
      const originalSubject = threading.originalSubject ?? rawSubject;
      let replyToId: string | null = null;
      let replyResult: { messageId: string; outlookMessageId: string } | null = null;

      const replyParams = {
        recipientEmail: input.to as string,
        subject,
        htmlBody: htmlBodyWithPixel,
        fromEmail,
        fromName: (input.fromName as string | undefined) ?? null,
        connectionId: emailProvider.connectionId,
      };

      // Strategy 1: Try stored outlook_message_id via createReply
      if (storedId) {
        console.log(`[email-sender] Strategy 1: trying stored ID for createReply: ${storedId}`);
        replyResult = await tryCreateReply({ outlookMessageId: storedId, ...replyParams });
      }

      // Strategy 2: Search Outlook for a valid thread message (received or sent)
      if (!replyResult) {
        console.log(`[email-sender] Strategy 2: searching Outlook for thread message`);
        replyToId = await findOutlookThreadMessage(
          nangoThread,
          emailProvider.connectionId,
          originalSubject,
          input.to as string
        );

        if (replyToId && replyToId !== storedId) {
          console.log(`[email-sender] Found thread message via search: ${replyToId}`);
          replyResult = await tryCreateReply({ outlookMessageId: replyToId, ...replyParams });
        }
      }

      // Strategy 3: Last resort — sendMail with Re: subject (no conversationId threading)
      if (replyResult) {
        messageId = replyResult.messageId;
        outlookMessageId = replyResult.outlookMessageId;
      } else {
        console.warn(`[email-sender] Strategy 3: all createReply attempts failed — using sendMail fallback`);
        const fallbackResult = await sendMailFallback(replyParams);
        messageId = fallbackResult.messageId;
        outlookMessageId = fallbackResult.outlookMessageId;
      }
    } else {
      // Outlook initial outreach: draft → send
      const result = await sendViaOutlook({
        to: input.to as string,
        subject,
        htmlBody: htmlBodyWithPixel,
        fromEmail,
        fromName: (input.fromName as string | undefined) ?? null,
        connectionId: emailProvider.connectionId,
      });
      messageId = result.messageId;
      outlookMessageId = result.outlookMessageId;
    }
  } catch (sendErr) {
    // Mark as failed so the UI can show error state + retry button
    const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    await db
      .from("skyler_actions")
      .update({
        status: "failed",
        result: { last_error: errMsg, failed_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionId);
    throw new Error(`Email send failed: ${errMsg}`);
  }

  // Mark action as executed
  await db
    .from("skyler_actions")
    .update({
      status: "executed",
      result: { message_id: messageId, provider: emailProvider.provider },
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId);

  // Store open tracking record (fire-and-forget — don't block on failure)
  try {
    await db.from("skyler_email_opens").insert({
      tracking_id: trackingId,
      workspace_id: workspaceId,
      pipeline_id: pipelineId,
      cadence_step: currentStep,
    });
    console.log(`[email-sender] Open tracking pixel stored: ${trackingId}`);
  } catch (trackErr) {
    console.error("[email-sender] Failed to store tracking pixel:", trackErr instanceof Error ? trackErr.message : trackErr);
  }

  // Update pipeline record
  const now = new Date().toISOString();

  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("cadence_step, emails_sent, conversation_thread")
    .eq("id", pipelineId)
    .single();

  const nextCadence = DEFAULT_CADENCE.find((c) => c.step === currentStep + 1);
  const nextFollowup = nextCadence
    ? new Date(Date.now() + nextCadence.delay_days * 86400000).toISOString()
    : null;

  const { CADENCE_STEP_STAGE } = await import("@/lib/skyler/pipeline-stages");
  const stageMap = CADENCE_STEP_STAGE;

  // Append to conversation thread — store outlook_message_id for deterministic threading
  const thread = (pipeline?.conversation_thread ?? []) as Array<Record<string, unknown>>;
  thread.push({
    role: "skyler",
    content: input.textBody,
    subject,
    timestamp: now,
    message_id: messageId,
    internet_message_id: internetMessageId,
    outlook_message_id: outlookMessageId,
    provider: emailProvider.provider,
    status: "sent",
  });

  await db
    .from("skyler_sales_pipeline")
    .update({
      last_email_sent_at: now,
      emails_sent: (pipeline?.emails_sent ?? 0) + 1,
      cadence_step: currentStep,
      stage: stageMap[currentStep] ?? "follow_up_3",
      next_followup_at: nextFollowup,
      awaiting_reply: true,
      conversation_thread: thread,
      updated_at: now,
    })
    .eq("id", pipelineId);

  console.log(`[email-sender] Email sent via ${emailProvider.provider}: ${messageId} (step ${currentStep})`);
  return { messageId };
}

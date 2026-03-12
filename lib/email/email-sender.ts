/**
 * Email sender for Skyler Sales Closer.
 * Sends through the user's connected Gmail or Outlook via Nango proxy.
 * Drafts are stored in skyler_actions for user approval.
 * Actual sending only happens when the user approves.
 */

import { Nango } from "@nangohq/node";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const description = `Send outreach email to ${params.to}: "${params.subject}"`;

  const { data, error } = await db
    .from("skyler_actions")
    .insert({
      workspace_id: params.workspaceId,
      tool_name: "send_email",
      tool_input: {
        to: params.to,
        subject: params.subject,
        htmlBody: params.htmlBody,
        textBody: params.textBody,
        replyTo: params.replyTo ?? null,
        fromName: params.fromName ?? null,
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
};

function getThreadingInfo(thread: Array<Record<string, unknown>>): ThreadingInfo {
  const messageIds: string[] = [];
  let originalSubject: string | null = null;
  let hasProspectReply = false;

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
  }

  return {
    inReplyTo: messageIds.length > 0 ? messageIds[messageIds.length - 1] : null,
    references: messageIds,
    originalSubject,
    isReplyThread: hasProspectReply,
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
  connectionId: string;
  inReplyTo?: string | null;
  references?: string[];
}): Promise<{ messageId: string; internetMessageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Generate a Message-ID for threading
  const domain = params.fromEmail.split("@")[1] ?? "cleverfolks.com";
  const generatedMessageId = `<${randomUUID()}@${domain}>`;

  // Build RFC 2822 email with threading headers
  const headers: string[] = [
    `From: ${params.fromEmail}`,
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
 * Send initial outreach via Outlook using sendMail.
 * Used only for the FIRST email — no threading needed.
 */
async function sendViaOutlook(params: {
  to: string;
  subject: string;
  htmlBody: string;
  connectionId: string;
}): Promise<{ messageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

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
      },
      saveToSentItems: true,
    },
  });

  const messageId = `outlook-${Date.now()}`;
  console.log(`[email-sender] Outlook sendMail success: ${messageId}`);
  return { messageId };
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
  const baseSubject = subject.replace(/^re:\s*/i, "").trim().replace(/'/g, "''");
  const safeEmail = recipientEmail.toLowerCase();

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

    console.log(`[email-sender] No received message from ${safeEmail} — falling back to Sent Items`);
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

    console.log(`[email-sender] No Sent Item found for subject="${baseSubject}" to=${safeEmail}`);
  } catch (err) {
    console.warn(`[email-sender] Sent Items search failed:`, err);
  }

  return null;
}

/**
 * Reply to an existing Outlook thread: createReply → PATCH → send.
 * createReply inherits conversationId and threading from the original message.
 * We PATCH to set our body and correct recipient (since the original was sent
 * BY us, the default reply-to would be ourselves).
 * Requires Mail.Read + Mail.Send scopes.
 */
async function replyViaOutlook(params: {
  outlookMessageId: string;
  recipientEmail: string;
  htmlBody: string;
  connectionId: string;
}): Promise<{ messageId: string }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Step 1: Create a reply draft (inherits threading from original message)
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
  if (!draftId) {
    throw new Error("Failed to create Outlook reply draft — no draft ID returned");
  }

  // Step 2: Update the draft with our content and correct recipient
  await nango.proxy({
    method: "PATCH",
    baseUrlOverride: "https://graph.microsoft.com",
    endpoint: `/v1.0/me/messages/${draftId}`,
    connectionId: params.connectionId,
    providerConfigKey: "outlook",
    data: {
      body: { contentType: "HTML", content: params.htmlBody },
      toRecipients: [{ emailAddress: { address: params.recipientEmail } }],
    },
  });

  // Step 3: Send the draft
  await nango.proxy({
    method: "POST",
    baseUrlOverride: "https://graph.microsoft.com",
    endpoint: `/v1.0/me/messages/${draftId}/send`,
    connectionId: params.connectionId,
    providerConfigKey: "outlook",
    data: {},
  });

  const messageId = `outlook-reply-${Date.now()}`;
  console.log(`[email-sender] Outlook reply success: ${messageId} (thread from ${params.outlookMessageId})`);
  return { messageId };
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
    .select("conversation_thread")
    .eq("id", pipelineId)
    .single();

  const existingThread = (pipelineForThread?.conversation_thread ?? []) as Array<Record<string, unknown>>;
  const threading = getThreadingInfo(existingThread);

  // Enforce "Re:" subject for reply threads (prospect has replied)
  const rawSubject = input.subject as string;
  const subject = enforceReplySubject(rawSubject, threading.originalSubject, threading.isReplyThread);

  // Send through the connected provider with threading headers
  let messageId: string;
  let internetMessageId: string | null = null;
  try {
    if (emailProvider.provider === "google-mail") {
      const result = await sendViaGmail({
        to: input.to as string,
        subject,
        htmlBody: input.htmlBody as string,
        fromEmail,
        connectionId: emailProvider.connectionId,
        inReplyTo: threading.inReplyTo,
        references: threading.references,
      });
      messageId = result.messageId;
      internetMessageId = result.internetMessageId;
    } else if (existingThread.length > 0) {
      // Outlook follow-up: find best message to reply to for threading on both sides
      const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
      const originalSubject = threading.originalSubject ?? rawSubject;
      const sentMessageId = await findOutlookThreadMessage(
        nango,
        emailProvider.connectionId,
        originalSubject,
        input.to as string
      );

      if (sentMessageId) {
        const result = await replyViaOutlook({
          outlookMessageId: sentMessageId,
          recipientEmail: input.to as string,
          htmlBody: input.htmlBody as string,
          connectionId: emailProvider.connectionId,
        });
        messageId = result.messageId;
      } else {
        // No previous sent message found — fall back to sendMail
        console.warn(`[email-sender] No Sent Item found for threading — using sendMail`);
        const result = await sendViaOutlook({
          to: input.to as string,
          subject,
          htmlBody: input.htmlBody as string,
          connectionId: emailProvider.connectionId,
        });
        messageId = result.messageId;
      }
    } else {
      // Outlook initial outreach: plain sendMail
      const result = await sendViaOutlook({
        to: input.to as string,
        subject,
        htmlBody: input.htmlBody as string,
        connectionId: emailProvider.connectionId,
      });
      messageId = result.messageId;
    }
  } catch (sendErr) {
    // Leave action as 'pending' so it stays visible for retry
    const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    await db
      .from("skyler_actions")
      .update({
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

  // Update pipeline record
  const now = new Date().toISOString();

  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("cadence_step, emails_sent, conversation_thread")
    .eq("id", pipelineId)
    .single();

  const currentStep = (pipeline?.cadence_step ?? 0) + 1;
  const nextCadence = DEFAULT_CADENCE.find((c) => c.step === currentStep + 1);
  const nextFollowup = nextCadence
    ? new Date(Date.now() + nextCadence.delay_days * 86400000).toISOString()
    : null;

  const stageMap: Record<number, string> = {
    1: "initial_outreach",
    2: "follow_up_1",
    3: "follow_up_2",
    4: "follow_up_3",
  };

  // Append to conversation thread with internet_message_id for threading
  const thread = (pipeline?.conversation_thread ?? []) as Array<Record<string, unknown>>;
  thread.push({
    role: "skyler",
    content: input.textBody,
    subject,
    timestamp: now,
    message_id: messageId,
    internet_message_id: internetMessageId,
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

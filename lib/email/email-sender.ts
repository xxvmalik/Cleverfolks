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
 * Query Sent Items to capture the Outlook message ID and internetMessageId
 * of the most recently sent email. Called right after sendMail.
 */
async function captureSentItemIds(
  nango: Nango,
  connectionId: string
): Promise<{ outlookMessageId: string | null; internetMessageId: string | null }> {
  try {
    // Small delay to allow Outlook to process the send
    await new Promise((r) => setTimeout(r, 2000));

    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: "/v1.0/me/mailFolders/SentItems/messages?$top=1&$orderby=sentDateTime desc&$select=id,internetMessageId,conversationId",
      connectionId,
      providerConfigKey: "outlook",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (response as any)?.data?.value;
    if (messages && messages.length > 0) {
      const msg = messages[0];
      console.log(`[email-sender] Captured Sent Item: outlookId=${msg.id}, internetMessageId=${msg.internetMessageId}`);
      return {
        outlookMessageId: msg.id ?? null,
        internetMessageId: msg.internetMessageId ?? null,
      };
    }
  } catch (err) {
    console.warn(`[email-sender] Could not capture Sent Item IDs:`, err);
  }
  return { outlookMessageId: null, internetMessageId: null };
}

/**
 * Send initial outreach via Outlook using sendMail, then capture the
 * Outlook message ID from Sent Items for future /reply threading.
 */
async function sendViaOutlook(params: {
  to: string;
  subject: string;
  htmlBody: string;
  connectionId: string;
  inReplyTo?: string | null;
  references?: string[];
}): Promise<{ messageId: string; internetMessageId: string | null; outlookMessageId: string | null }> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Build threading headers for Outlook (Microsoft Graph)
  const internetMessageHeaders: Array<{ name: string; value: string }> = [];
  if (params.inReplyTo) {
    internetMessageHeaders.push({ name: "In-Reply-To", value: params.inReplyTo });
  }
  if (params.references && params.references.length > 0) {
    internetMessageHeaders.push({ name: "References", value: params.references.join(" ") });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message: Record<string, any> = {
    subject: params.subject,
    body: {
      contentType: "HTML",
      content: params.htmlBody,
    },
    toRecipients: [
      { emailAddress: { address: params.to } },
    ],
  };

  if (internetMessageHeaders.length > 0) {
    message.internetMessageHeaders = internetMessageHeaders;
  }

  // Use sendMail (requires only Mail.Send scope, not Mail.ReadWrite)
  await nango.proxy({
    method: "POST",
    baseUrlOverride: "https://graph.microsoft.com",
    endpoint: "/v1.0/me/sendMail",
    connectionId: params.connectionId,
    providerConfigKey: "outlook",
    data: { message },
  });

  // Query Sent Items to capture the Outlook message ID for future /reply calls
  const sentIds = await captureSentItemIds(nango, params.connectionId);

  const messageId = sentIds.outlookMessageId ?? `outlook-${Date.now()}`;
  console.log(`[email-sender] Outlook sendMail success: ${messageId}`);
  return {
    messageId,
    internetMessageId: sentIds.internetMessageId,
    outlookMessageId: sentIds.outlookMessageId,
  };
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
  let outlookMessageId: string | null = null;
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
    } else {
      // Outlook: always use sendMail with threading headers (In-Reply-To + References)
      // Threading headers ensure the recipient's mail client groups the conversation
      const result = await sendViaOutlook({
        to: input.to as string,
        subject,
        htmlBody: input.htmlBody as string,
        connectionId: emailProvider.connectionId,
        inReplyTo: threading.inReplyTo,
        references: threading.references,
      });
      messageId = result.messageId;
      internetMessageId = result.internetMessageId;
      outlookMessageId = result.outlookMessageId;
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

  // Append to conversation thread with internet_message_id + outlook_message_id for threading
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

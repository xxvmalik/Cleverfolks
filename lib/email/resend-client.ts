/**
 * Resend email client for Skyler Sales Closer.
 * APPROVAL MODE ONLY: drafts are stored in skyler_actions for user approval.
 * Actual sending only happens when the user approves.
 */

import { Resend } from "resend";
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

// Default follow-up cadence (hardcoded for now)
export const DEFAULT_CADENCE = [
  { step: 1, delay_days: 0, angle: "initial_outreach" as const },
  { step: 2, delay_days: 3, angle: "different_value_prop" as const },
  { step: 3, delay_days: 7, angle: "social_proof_or_case_study" as const },
  { step: 4, delay_days: 14, angle: "breakup_final_attempt" as const },
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

  console.log(`[resend-client] Email draft stored for approval: ${data.id}`);
  return { actionId: data.id };
}

/**
 * Execute an approved email send via Resend.
 * Called ONLY when user approves the pending action.
 */
export async function executeEmailSend(
  db: SupabaseClient,
  actionId: string
): Promise<{ resendId: string }> {
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

  // Send via Resend
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "skyler@cleverfolks.ai";
  const fromName = (input.fromName as string) ?? "Skyler";

  const { data: emailResult, error: sendErr } = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: [input.to as string],
    subject: input.subject as string,
    html: input.htmlBody as string,
    text: input.textBody as string,
    replyTo: (input.replyTo as string) ?? undefined,
  });

  if (sendErr || !emailResult?.id) {
    // Leave action as 'pending' so it stays visible for retry — just store the error
    await db
      .from("skyler_actions")
      .update({ result: { last_error: sendErr?.message ?? "Send failed", failed_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
      .eq("id", actionId);
    throw new Error(`Resend send failed: ${sendErr?.message ?? "unknown error"}`);
  }

  const resendId = emailResult.id;

  // Mark action as executed
  await db
    .from("skyler_actions")
    .update({ status: "executed", result: { resend_id: resendId }, updated_at: new Date().toISOString() })
    .eq("id", actionId);

  // Update pipeline record
  const now = new Date().toISOString();

  // Get current pipeline record for cadence step
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

  // Stage mapping based on cadence step
  const stageMap: Record<number, string> = {
    1: "initial_outreach",
    2: "follow_up_1",
    3: "follow_up_2",
    4: "follow_up_3",
  };

  // Append to conversation thread
  const thread = (pipeline?.conversation_thread ?? []) as Array<Record<string, unknown>>;
  thread.push({
    role: "skyler",
    content: input.textBody,
    subject: input.subject,
    timestamp: now,
    resend_id: resendId,
    status: "sent",
  });

  await db
    .from("skyler_sales_pipeline")
    .update({
      last_email_sent_at: now,
      last_email_resend_id: resendId,
      emails_sent: (pipeline?.emails_sent ?? 0) + 1,
      cadence_step: currentStep,
      stage: stageMap[currentStep] ?? "follow_up_3",
      next_followup_at: nextFollowup,
      awaiting_reply: true,
      conversation_thread: thread,
      updated_at: now,
    })
    .eq("id", pipelineId);

  console.log(`[resend-client] Email sent: ${resendId} (step ${currentStep})`);
  return { resendId };
}

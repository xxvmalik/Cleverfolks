/**
 * GET /api/skyler/reply-check-debug
 *
 * Diagnostic endpoint — mirrors the cron logic AND runs detectPipelineReply
 * on matched emails to show exactly where detection succeeds or fails.
 */

import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { extractSenderFromMetadata } from "@/lib/sync/email-prefilter";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createAdminSupabaseClient();

  // Resolve workspace
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const workspaceId = membership.workspace_id;

  const diag: Record<string, unknown> = { workspaceId };

  // 1. All pipeline records
  const { data: allPipelines, error: pipelineErr } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, contact_name, company_name, stage, resolution, awaiting_reply, last_reply_at, last_email_sent_at, emails_sent, emails_replied, cadence_step, conversation_thread")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  diag.totalPipelines = allPipelines?.length ?? 0;
  diag.pipelineError = pipelineErr?.message ?? null;

  // Match actual cron logic: unresolved OR engaged/no_response
  const unresolvedPipelines = (allPipelines ?? []).filter((p) => !p.resolution);
  const engagedPipelines = (allPipelines ?? []).filter((p) =>
    ["meeting_booked", "demo_booked", "no_response"].includes(p.resolution)
  );
  const checkablePipelines = [...unresolvedPipelines, ...engagedPipelines];

  diag.unresolvedCount = unresolvedPipelines.length;
  diag.engagedCount = engagedPipelines.length;
  diag.checkablePipelines = checkablePipelines.map((p) => ({
    id: p.id,
    contact_email: p.contact_email,
    contact_name: p.contact_name,
    resolution: p.resolution,
    awaiting_reply: p.awaiting_reply,
    stage: p.stage,
    last_reply_at: p.last_reply_at,
    threadLength: (p.conversation_thread ?? []).length,
    prospectEntries: (p.conversation_thread ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.role === "prospect"
    ).length,
  }));

  if (checkablePipelines.length === 0) {
    diag.issue = "No checkable pipeline records — cron would skip this workspace";
    return NextResponse.json(diag);
  }

  // 2. Email integration
  const { data: integrations, error: intErr } = await db
    .from("integrations")
    .select("id, provider, nango_connection_id, status")
    .eq("workspace_id", workspaceId)
    .in("provider", ["google-mail", "outlook"]);

  diag.emailIntegrations = integrations ?? [];
  diag.emailIntegrationError = intErr?.message ?? null;

  const connected = (integrations ?? []).filter((i) => i.status === "connected");
  if (connected.length === 0) {
    diag.issue = "No connected email integration";
    return NextResponse.json(diag);
  }

  const integration = connected[0];
  diag.usingProvider = integration.provider;

  // 3. Contact list
  const contactEmails = [...new Set(
    checkablePipelines.map((p) => (p.contact_email as string).toLowerCase())
  )];
  diag.contactEmailsToCheck = contactEmails;

  if (!process.env.NANGO_SECRET_KEY) {
    diag.issue = "NANGO_SECRET_KEY not set";
    return NextResponse.json(diag);
  }

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const windowStart = Date.now() - 24 * 60 * 60 * 1000;

  // 4. Query inbox and run detection simulation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectionResults: any[] = [];

  try {
    if (integration.provider === "outlook") {
      const response = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: `/v1.0/me/mailFolders/Inbox/messages?$top=30&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,body,receivedDateTime`,
        connectionId: integration.nango_connection_id,
        providerConfigKey: "outlook",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = (response as any)?.data?.value;
      diag.nangoProxySuccess = true;
      diag.messagesReturned = messages?.length ?? 0;
      diag.timeWindow = "24 hours";

      // For each message from a pipeline contact within the window, simulate detection
      for (const msg of (messages ?? [])) {
        const receivedAt = new Date(msg.receivedDateTime).getTime();
        if (receivedAt < windowStart) continue;

        const rawSender = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
        if (!rawSender || !rawSender.includes("@")) continue;
        if (!contactEmails.includes(rawSender)) continue;

        // Skip calendar notifications
        const subject = (msg.subject ?? "") as string;
        if (/^(Accepted|Tentative|Declined|Cancelled|Updated):/i.test(subject)) continue;

        // Build content the same way the cron does
        const fromName = msg.from?.emailAddress?.name ?? "";
        const body = msg.body?.content
          ? msg.body.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000)
          : msg.bodyPreview ?? "";
        const content = `From: ${fromName ? `${fromName} <${rawSender}>` : rawSender}\nSubject: ${subject}\n\n${body}`;

        // Simulate detectPipelineReply step by step
        const result: Record<string, unknown> = {
          sender: rawSender,
          subject,
          receivedAt: msg.receivedDateTime,
          contentFirst200: content.slice(0, 200),
        };

        // Step A: extract sender
        const senderEmail = extractSenderFromMetadata({
          from: { emailAddress: { address: rawSender } },
        });
        result.extractedSender = senderEmail;

        // Step B: find pipeline record
        const matchedPipeline = checkablePipelines.find(
          (p) => (p.contact_email as string).toLowerCase() === senderEmail
        );
        result.pipelineMatch = matchedPipeline ? {
          id: matchedPipeline.id,
          resolution: matchedPipeline.resolution,
          last_reply_at: matchedPipeline.last_reply_at,
        } : null;

        if (!matchedPipeline) {
          result.rejection = "no_pipeline_match";
          detectionResults.push(result);
          continue;
        }

        // Step C: content dedup check
        const existingThread = (matchedPipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
        const replyContent = content.slice(0, 3000);
        const prospectEntries = existingThread.filter((e) => e.role === "prospect");
        result.prospectEntriesInThread = prospectEntries.length;

        const duplicateEntry = prospectEntries.find(
          (entry) =>
            typeof entry.content === "string" &&
            (entry.content as string).slice(0, 200) === replyContent.slice(0, 200)
        );
        result.contentDuplicate = duplicateEntry ? {
          match: true,
          existingFirst200: (duplicateEntry.content as string).slice(0, 200),
          newFirst200: replyContent.slice(0, 200),
        } : { match: false };

        if (duplicateEntry) {
          result.rejection = "content_dedup";
          detectionResults.push(result);
          continue;
        }

        // Step D: atomic dedup (last_reply_at check)
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const lastReply = matchedPipeline.last_reply_at as string | null;
        if (lastReply && lastReply >= fiveMinAgo) {
          result.rejection = "atomic_dedup_5min_lock";
          result.lastReplyAt = lastReply;
          result.fiveMinAgo = fiveMinAgo;
          detectionResults.push(result);
          continue;
        }

        result.rejection = null;
        result.wouldDetect = true;
        detectionResults.push(result);
      }

      diag.detectionResults = detectionResults;
      diag.wouldDetectCount = detectionResults.filter((r) => r.wouldDetect).length;
      diag.rejectedCount = detectionResults.filter((r) => r.rejection).length;
      diag.rejectionReasons = detectionResults
        .filter((r) => r.rejection)
        .map((r) => ({ sender: r.sender, reason: r.rejection }));
    }
  } catch (err) {
    diag.nangoProxySuccess = false;
    diag.nangoProxyError = err instanceof Error ? err.message : String(err);
  }

  diag.inngestEventKey = process.env.INNGEST_EVENT_KEY ? "set" : "MISSING";
  diag.inngestSigningKey = process.env.INNGEST_SIGNING_KEY ? "set" : "MISSING";

  return NextResponse.json(diag);
}

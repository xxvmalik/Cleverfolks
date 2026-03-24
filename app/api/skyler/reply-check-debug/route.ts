/**
 * GET /api/skyler/reply-check-debug
 *
 * Diagnostic endpoint — runs the reply check logic for the current user's
 * workspace and returns detailed results instead of just logging them.
 * Use this to verify the cron would detect replies if it were running.
 */

import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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

  // 1. Check pipeline records awaiting reply
  const { data: pipelines, error: pipelineErr } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, stage, awaiting_reply, last_reply_at, last_email_sent_at")
    .eq("workspace_id", workspaceId)
    .is("resolution", null);

  diag.totalPipelines = pipelines?.length ?? 0;
  diag.pipelineError = pipelineErr?.message ?? null;
  diag.awaitingReply = (pipelines ?? []).filter((p) => p.awaiting_reply === true);
  diag.awaitingReplyCount = (diag.awaitingReply as unknown[]).length;

  if ((diag.awaitingReply as unknown[]).length === 0) {
    diag.issue = "No pipeline records with awaiting_reply=true — cron would skip this workspace";
    return NextResponse.json(diag);
  }

  // 2. Check email integration
  const { data: integrations, error: intErr } = await db
    .from("integrations")
    .select("id, provider, nango_connection_id, status")
    .eq("workspace_id", workspaceId)
    .in("provider", ["google-mail", "outlook"]);

  diag.emailIntegrations = integrations ?? [];
  diag.emailIntegrationError = intErr?.message ?? null;

  const connected = (integrations ?? []).filter((i) => i.status === "connected");
  diag.connectedEmailIntegrations = connected;

  if (connected.length === 0) {
    diag.issue = "No connected email integration (google-mail or outlook) — cron cannot check inbox";
    return NextResponse.json(diag);
  }

  const integration = connected[0];
  diag.usingProvider = integration.provider;
  diag.usingConnectionId = integration.nango_connection_id;

  // 3. Try Nango proxy call
  const contactEmails = (diag.awaitingReply as Array<{ contact_email: string }>)
    .map((p) => p.contact_email.toLowerCase());
  diag.contactEmailsToCheck = contactEmails;

  if (!process.env.NANGO_SECRET_KEY) {
    diag.issue = "NANGO_SECRET_KEY not set — cannot query email provider";
    return NextResponse.json(diag);
  }

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  try {
    if (integration.provider === "outlook") {
      const response = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: `/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,receivedDateTime`,
        connectionId: integration.nango_connection_id,
        providerConfigKey: "outlook",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = (response as any)?.data?.value;
      diag.nangoProxySuccess = true;
      diag.messagesReturned = messages?.length ?? 0;

      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      const recentMessages = (messages ?? []).filter((m: { receivedDateTime: string }) =>
        new Date(m.receivedDateTime).getTime() > tenMinAgo
      );
      diag.messagesInLast10Min = recentMessages.length;

      // Check which messages are from pipeline contacts
      const matches = (messages ?? [])
        .map((m: { from?: { emailAddress?: { address?: string } }; subject?: string; receivedDateTime?: string; bodyPreview?: string }) => ({
          sender: m.from?.emailAddress?.address?.toLowerCase(),
          subject: m.subject,
          receivedAt: m.receivedDateTime,
          preview: (m.bodyPreview ?? "").slice(0, 100),
          isContact: contactEmails.includes(m.from?.emailAddress?.address?.toLowerCase() ?? ""),
          isRecent: new Date(m.receivedDateTime ?? 0).getTime() > tenMinAgo,
        }))
        .slice(0, 10); // Show top 10

      diag.top10Messages = matches;
      diag.contactMatches = matches.filter((m: { isContact: boolean }) => m.isContact);
    } else if (integration.provider === "google-mail") {
      const fromQuery = contactEmails.slice(0, 10).map((e) => `from:${e}`).join(" OR ");
      const query = `${fromQuery} newer_than:1d`;

      const searchResponse = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://gmail.googleapis.com",
        endpoint: `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
        connectionId: integration.nango_connection_id,
        providerConfigKey: "google-mail",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messageList = (searchResponse as any)?.data?.messages;
      diag.nangoProxySuccess = true;
      diag.messagesReturned = messageList?.length ?? 0;
      diag.messageIds = (messageList ?? []).map((m: { id: string }) => m.id);
    }
  } catch (err) {
    diag.nangoProxySuccess = false;
    diag.nangoProxyError = err instanceof Error ? err.message : String(err);
    diag.issue = `Nango proxy call failed: ${diag.nangoProxyError}`;
  }

  // 4. Check if Inngest cron should be registered
  diag.inngestEventKey = process.env.INNGEST_EVENT_KEY ? "set" : "MISSING";
  diag.inngestSigningKey = process.env.INNGEST_SIGNING_KEY ? "set" : "MISSING";

  return NextResponse.json(diag);
}

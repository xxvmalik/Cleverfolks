/**
 * GET /api/skyler/reply-check-debug
 *
 * Diagnostic endpoint — runs the reply check logic for the current user's
 * workspace and returns detailed results instead of just logging them.
 * Use this to verify the cron would detect replies if it were running.
 *
 * Mirrors the actual cron logic: no awaiting_reply filter, includes
 * no_response and meeting_booked/demo_booked records, 24-hour time window.
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

  // 1. Check ALL pipeline records to show full status
  const { data: allPipelines, error: pipelineErr } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, contact_name, company_name, stage, resolution, awaiting_reply, last_reply_at, last_email_sent_at, emails_sent, emails_replied, cadence_step")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  diag.totalPipelines = allPipelines?.length ?? 0;
  diag.pipelineError = pipelineErr?.message ?? null;
  diag.allPipelines = allPipelines ?? [];

  // Match the actual cron logic: unresolved OR engaged/no_response (no awaiting_reply filter)
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
  }));

  if (checkablePipelines.length === 0) {
    diag.issue = "No unresolved or engaged pipeline records — cron would skip this workspace";
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

  // 3. Build contact list (matches actual cron — no awaiting_reply filter)
  const contactEmails = [...new Set(
    checkablePipelines.map((p) => (p.contact_email as string).toLowerCase())
  )];
  diag.contactEmailsToCheck = contactEmails;

  if (!process.env.NANGO_SECRET_KEY) {
    diag.issue = "NANGO_SECRET_KEY not set — cannot query email provider";
    return NextResponse.json(diag);
  }

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const windowStart = Date.now() - 24 * 60 * 60 * 1000;

  try {
    if (integration.provider === "outlook") {
      const response = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com",
        endpoint: `/v1.0/me/mailFolders/Inbox/messages?$top=30&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,receivedDateTime`,
        connectionId: integration.nango_connection_id,
        providerConfigKey: "outlook",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = (response as any)?.data?.value;
      diag.nangoProxySuccess = true;
      diag.messagesReturned = messages?.length ?? 0;

      const recentMessages = (messages ?? []).filter((m: { receivedDateTime: string }) =>
        new Date(m.receivedDateTime).getTime() > windowStart
      );
      diag.messagesInLast24h = recentMessages.length;
      diag.queryEndpoint = "Inbox only (not all folders)";
      diag.timeWindow = "24 hours";

      // Check which messages are from pipeline contacts
      const matches = (messages ?? [])
        .map((m: { from?: { emailAddress?: { address?: string } }; subject?: string; receivedDateTime?: string; bodyPreview?: string }) => {
          const rawSender = m.from?.emailAddress?.address?.toLowerCase() ?? "";
          const isX500 = rawSender.startsWith("/o=") || !rawSender.includes("@");
          return {
            sender: rawSender,
            isX500,
            subject: m.subject,
            receivedAt: m.receivedDateTime,
            preview: (m.bodyPreview ?? "").slice(0, 100),
            isContact: !isX500 && contactEmails.includes(rawSender),
            isInWindow: new Date(m.receivedDateTime ?? 0).getTime() > windowStart,
          };
        })
        .slice(0, 15);

      diag.top15InboxMessages = matches;
      diag.contactMatches = matches.filter((m: { isContact: boolean; isInWindow: boolean }) => m.isContact && m.isInWindow);
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

  // 4. Check Inngest config
  diag.inngestEventKey = process.env.INNGEST_EVENT_KEY ? "set" : "MISSING";
  diag.inngestSigningKey = process.env.INNGEST_SIGNING_KEY ? "set" : "MISSING";

  return NextResponse.json(diag);
}

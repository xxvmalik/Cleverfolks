/**
 * GET /api/skyler/reply-check-trigger
 *
 * Runs the ACTUAL reply-check logic (not a simulation) for the current user's
 * workspace and returns detailed results. Unlike the debug endpoint, this
 * calls the real detectPipelineReply function so we can see exactly what
 * happens in production.
 */

import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { detectPipelineReply } from "@/lib/sync/reply-detector";

function extractOutlookSender(msg: { from?: { emailAddress?: { address?: string } } }): string | null {
  const raw = msg.from?.emailAddress?.address;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith("/o=") || !lower.includes("@")) return null;
  return lower;
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

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createAdminSupabaseClient();

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const workspaceId = membership.workspace_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diag: Record<string, any> = { workspaceId };

  // 1. Get pipeline contacts (same logic as cron)
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
  const contactEmails = [...new Set(pipelines.map((p) => (p.contact_email as string).toLowerCase()))];
  diag.contactEmails = contactEmails;

  if (contactEmails.length === 0) {
    diag.issue = "No pipeline contacts found";
    return NextResponse.json(diag);
  }

  // 2. Get email integration
  const { data: integration } = await db
    .from("integrations")
    .select("provider, nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", ["google-mail", "outlook"])
    .maybeSingle();

  if (!integration?.nango_connection_id) {
    diag.issue = "No connected email integration";
    return NextResponse.json(diag);
  }
  diag.provider = integration.provider;

  if (!process.env.NANGO_SECRET_KEY) {
    diag.issue = "NANGO_SECRET_KEY not set";
    return NextResponse.json(diag);
  }

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const windowStart = Date.now() - 24 * 60 * 60 * 1000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = [];

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
      diag.messagesReturned = messages?.length ?? 0;

      for (const msg of (messages ?? [])) {
        const receivedAt = new Date(msg.receivedDateTime).getTime();
        if (receivedAt < windowStart) continue;

        const senderEmail = extractOutlookSender(msg);
        if (!senderEmail || !contactEmails.includes(senderEmail)) continue;

        const subject = (msg.subject ?? "") as string;
        if (/^(Accepted|Tentative|Declined|Cancelled|Updated):/i.test(subject)) continue;

        // Build content exactly like the cron does
        const fromName = msg.from?.emailAddress?.name ?? "";
        const body = msg.body?.content
          ? stripHtml(msg.body.content)
          : msg.bodyPreview ?? "";
        const content = `From: ${fromName ? `${fromName} <${senderEmail}>` : senderEmail}\nSubject: ${subject}\n\n${body}`;

        // Call the REAL detectPipelineReply
        const startTime = Date.now();
        let result;
        let error = null;
        try {
          result = await detectPipelineReply(db, workspaceId, {
            content,
            metadata: {
              from: { emailAddress: { address: senderEmail } },
              subject: msg.subject,
              receivedDateTime: msg.receivedDateTime,
              outlook_message_id: msg.id,
            },
          });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          result = { is_reply: false };
        }

        results.push({
          sender: senderEmail,
          subject,
          receivedAt: msg.receivedDateTime,
          contentFirst100: content.slice(0, 100),
          detectResult: result,
          detectError: error,
          detectDurationMs: Date.now() - startTime,
        });
      }
    }
  } catch (err) {
    diag.nangoError = err instanceof Error ? err.message : String(err);
  }

  diag.results = results;
  diag.detectedReplies = results.filter((r) => r.detectResult?.is_reply).length;
  diag.failedDetections = results.filter((r) => !r.detectResult?.is_reply).length;
  diag.errors = results.filter((r) => r.detectError).length;

  return NextResponse.json(diag);
}

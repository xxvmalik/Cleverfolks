/**
 * Test route: Debug email notification delivery.
 * GET /api/test/email-notify
 *
 * Steps:
 * 1. Check RESEND_API_KEY env var
 * 2. Load workspace notification settings (show raw config)
 * 3. Resolve email targets
 * 4. Send a test email via Resend
 * 5. Return the full Resend API response
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Resend } from "resend";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    // ── Step 1: Check Resend API key ────────────────────────────────────
    const apiKey = process.env.RESEND_API_KEY;
    steps.resendApiKey = {
      isSet: !!apiKey,
      prefix: apiKey ? `${apiKey.slice(0, 8)}...` : null,
      diagnosis: apiKey ? "OK: RESEND_API_KEY is set" : "PROBLEM: RESEND_API_KEY is not set in environment variables",
    };

    if (!apiKey) {
      return NextResponse.json({
        steps,
        error: "RESEND_API_KEY not set — email notifications will always silently skip",
        fix: "Add RESEND_API_KEY to .env.local (get it from https://resend.com/api-keys)",
      }, { status: 400 });
    }

    // ── Step 2: Load workspace settings ─────────────────────────────────
    const db = createAdminSupabaseClient();
    const { data: ws, error: wsErr } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", WORKSPACE_ID)
      .single();

    if (!ws) {
      return NextResponse.json({
        steps,
        error: "Workspace not found",
        detail: wsErr?.message,
      }, { status: 404 });
    }

    const settings = (ws.settings ?? {}) as Record<string, unknown>;
    const workflow = (settings.skyler_workflow ?? {}) as Record<string, unknown>;
    const notifications = (workflow.notifications ?? {}) as Record<string, unknown>;

    steps.workflowSettings = {
      autonomyLevel: workflow.autonomyLevel ?? "not_set",
      notifications,
    };

    // ── Step 3: Check email config ──────────────────────────────────────
    const emailEnabled = notifications.email;
    const hasEmailAddresses = Array.isArray(notifications.emailAddresses) && notifications.emailAddresses.length > 0;
    const hasLegacyEmail = typeof notifications.emailAddress === "string" && notifications.emailAddress !== "";

    const resolvedEmails: string[] = [];
    if (hasEmailAddresses) {
      resolvedEmails.push(...(notifications.emailAddresses as string[]).filter(Boolean).slice(0, 3));
    } else if (hasLegacyEmail) {
      resolvedEmails.push((notifications.emailAddress as string).trim());
    }

    steps.emailConfig = {
      emailEnabled,
      hasEmailAddresses_newFormat: hasEmailAddresses,
      emailAddresses: notifications.emailAddresses ?? null,
      hasLegacyEmail,
      legacyEmailAddress: notifications.emailAddress ?? null,
      resolvedEmails,
      diagnosis: !emailEnabled
        ? "PROBLEM: email is disabled in notification settings"
        : resolvedEmails.length === 0
        ? "PROBLEM: No email addresses configured (need emailAddresses array or emailAddress string)"
        : `OK: ${resolvedEmails.length} email(s) configured`,
    };

    // ── Step 4: Check Resend domain verification ────────────────────────
    const resend = new Resend(apiKey);
    let domainStatus: unknown = null;
    try {
      const domains = await resend.domains.list();
      domainStatus = domains;
      const cleverfolksDomain = (domains.data?.data ?? []).find(
        (d: { name: string }) => d.name === "cleverfolks.app"
      );
      steps.resendDomain = {
        allDomains: (domains.data?.data ?? []).map((d: { name: string; status: string }) => ({
          name: d.name,
          status: d.status,
        })),
        cleverfolksDomain: cleverfolksDomain ?? "NOT FOUND",
        diagnosis: cleverfolksDomain
          ? (cleverfolksDomain as { status: string }).status === "verified"
            ? "OK: cleverfolks.app domain is verified"
            : `PROBLEM: cleverfolks.app domain status is "${(cleverfolksDomain as { status: string }).status}" — needs to be verified`
          : "PROBLEM: cleverfolks.app domain not found in Resend — add and verify it at https://resend.com/domains",
      };
    } catch (err: unknown) {
      const e = err as { message?: string; statusCode?: number };
      steps.resendDomain = {
        status: "error",
        message: e.message,
        statusCode: e.statusCode,
        diagnosis: "Could not list Resend domains — API key may be invalid",
      };
    }

    // ── Step 5: Send test email ─────────────────────────────────────────
    // Use resolved emails from settings, or fall back to sending to a test address
    const targetEmail = resolvedEmails.length > 0 ? resolvedEmails[0] : null;

    if (!targetEmail) {
      // Load workspace owner email as fallback
      const { data: members } = await db
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("role", "owner")
        .limit(1);

      if (members && members.length > 0) {
        const { data: profile } = await db
          .from("profiles")
          .select("email")
          .eq("id", members[0].user_id)
          .single();

        if (profile?.email) {
          steps.targetResolution = {
            source: "workspace owner (no email configured in notifications)",
            email: profile.email,
          };
          return await sendTestEmail(resend, profile.email, steps);
        }
      }

      return NextResponse.json({
        steps,
        error: "No target email — configure emailAddresses in notification settings",
        fix: "Add emailAddresses array to workspace settings → skyler_workflow → notifications",
      }, { status: 400 });
    }

    steps.targetResolution = {
      source: hasEmailAddresses ? "emailAddresses[0]" : "legacy emailAddress",
      email: targetEmail,
    };

    return await sendTestEmail(resend, targetEmail, steps);
  } catch (err) {
    return NextResponse.json({
      steps,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}

async function sendTestEmail(
  resend: InstanceType<typeof Resend>,
  toEmail: string,
  steps: Record<string, unknown>
) {
  try {
    const result = await resend.emails.send({
      from: "Skyler <skyler@cleverfolks.app>",
      to: toEmail,
      subject: "Skyler Test Notification",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <div style="background: #131619; border-radius: 12px; padding: 24px; color: #fff;">
            <h2 style="margin: 0 0 8px; font-size: 18px; color: #3A89FF;">Test Notification</h2>
            <p style="margin: 0 0 16px; font-size: 15px; color: #fff;">This is a test email from Skyler.</p>
            <p style="margin: 0; font-size: 14px; color: #8B8F97;">
              Sent at ${new Date().toISOString()}. If you received this, email notifications are working!
            </p>
          </div>
          <p style="margin: 16px 0 0; font-size: 12px; color: #8B8F97; text-align: center;">
            Sent by Skyler, your AI Sales Employee — CleverFolks
          </p>
        </div>
      `,
    });

    steps.sendEmail = {
      status: "ok",
      resendResponse: result,
    };

    const resendData = result.data as { id?: string } | null;
    const resendError = result.error as { message?: string; name?: string } | null;

    return NextResponse.json({
      status: resendError ? "failed" : "ok",
      sentTo: toEmail,
      resendId: resendData?.id ?? null,
      resendError: resendError ?? null,
      steps,
      diagnosis: resendError
        ? `PROBLEM: Resend returned error: ${resendError.message}`
        : `Email sent successfully (ID: ${resendData?.id}). Check ${toEmail} inbox (and spam folder).`,
    });
  } catch (err: unknown) {
    const e = err as { message?: string; statusCode?: number };
    steps.sendEmail = {
      status: "error",
      message: e.message,
      statusCode: e.statusCode,
    };
    return NextResponse.json({
      steps,
      error: `Resend send failed: ${e.message}`,
    }, { status: 500 });
  }
}

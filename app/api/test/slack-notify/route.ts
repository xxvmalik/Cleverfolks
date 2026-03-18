/**
 * Test route: Debug Slack notification delivery.
 * GET /api/test/slack-notify
 *
 * Steps:
 * 1. Load workspace notification settings (show raw config)
 * 2. Check Slack integration in integrations table
 * 3. Resolve Slack targets (channels/users)
 * 4. Send a test message via Nango proxy
 * 5. Return the full Slack API response
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();

    // ── Step 1: Load workspace settings ─────────────────────────────────
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
    const autonomyLevel = workflow.autonomyLevel ?? "not_set";

    steps.workflowSettings = {
      autonomyLevel,
      notifications,
    };

    // ── Step 2: Check notification config format ────────────────────────
    const slackEnabled = notifications.slack;
    const hasSlackChannels = Array.isArray(notifications.slackChannels) && notifications.slackChannels.length > 0;
    const hasLegacySlackChannel = typeof notifications.slackChannel === "string" && notifications.slackChannel !== "";

    steps.slackConfig = {
      slackEnabled,
      hasSlackChannels_newFormat: hasSlackChannels,
      slackChannels: notifications.slackChannels ?? null,
      hasLegacySlackChannel,
      legacySlackChannel: notifications.slackChannel ?? null,
      diagnosis: !slackEnabled
        ? "PROBLEM: slack is disabled in notification settings"
        : !hasSlackChannels && hasLegacySlackChannel
        ? "PROBLEM: Using legacy slackChannel string format — resolveSlackTargets() returns [] because it needs {id, name, type} objects"
        : !hasSlackChannels && !hasLegacySlackChannel
        ? "PROBLEM: No Slack channels configured at all"
        : "OK: slackChannels array present with new format",
    };

    // ── Step 3: Check Slack integration ─────────────────────────────────
    const { data: integration, error: intErr } = await db
      .from("integrations")
      .select("id, provider, status, nango_connection_id, created_at")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "slack")
      .maybeSingle();

    steps.slackIntegration = integration
      ? { ...integration, diagnosis: integration.status === "connected" ? "OK" : `PROBLEM: status is "${integration.status}", not "connected"` }
      : { error: intErr?.message ?? "No Slack integration found", diagnosis: "PROBLEM: No Slack integration row in integrations table" };

    if (!integration?.nango_connection_id) {
      return NextResponse.json({
        steps,
        error: "No connected Slack integration — cannot send test message",
        fix: "Connect Slack via the Integrations page first",
      }, { status: 404 });
    }

    const connectionId = integration.nango_connection_id;

    // ── Step 4: Test Nango connection is valid ──────────────────────────
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    let authTest: unknown = null;
    try {
      const resp = await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://slack.com",
        endpoint: "/api/auth.test",
        connectionId,
        providerConfigKey: "slack",
        data: {},
      });
      authTest = resp.data;
      steps.authTest = { status: "ok", data: authTest };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      steps.authTest = {
        status: "error",
        statusCode: e.response?.status,
        responseBody: e.response?.data,
        message: e.message,
        diagnosis: "PROBLEM: Nango connection for Slack is invalid or token expired",
      };
      return NextResponse.json({ steps, error: "auth.test failed" }, { status: 500 });
    }

    // ── Step 5: Determine target channel ────────────────────────────────
    // Use configured channel if available, otherwise try the bot's first channel
    let targetChannel: string | null = null;
    let targetName = "unknown";

    if (hasSlackChannels) {
      const channels = notifications.slackChannels as Array<{ id: string; name: string; type: string }>;
      targetChannel = channels[0].id;
      targetName = channels[0].name;
      steps.targetResolution = { source: "slackChannels[0]", id: targetChannel, name: targetName };
    } else {
      // Try to list channels the bot is in
      try {
        const resp = await nango.proxy({
          method: "GET",
          baseUrlOverride: "https://slack.com",
          endpoint: "/api/conversations.list?types=public_channel,private_channel&limit=10",
          connectionId,
          providerConfigKey: "slack",
          data: {},
        });
        const data = resp.data as { ok: boolean; channels?: Array<{ id: string; name: string; is_member: boolean }> };
        const botChannels = data.channels?.filter((c) => c.is_member) ?? [];
        steps.botChannels = botChannels.map((c) => ({ id: c.id, name: c.name }));

        if (botChannels.length > 0) {
          targetChannel = botChannels[0].id;
          targetName = botChannels[0].name;
          steps.targetResolution = {
            source: "first channel bot is a member of",
            id: targetChannel,
            name: targetName,
            note: "No slackChannels configured — used fallback",
          };
        } else {
          steps.targetResolution = {
            diagnosis: "PROBLEM: Bot is not a member of any channels. Invite the bot to a channel with /invite @YourBotName",
          };
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: unknown }; message?: string };
        steps.botChannels = { error: e.message, data: e.response?.data };
      }
    }

    if (!targetChannel) {
      return NextResponse.json({
        steps,
        error: "No target channel available — see targetResolution for details",
        fix: "Either configure slackChannels in notification settings (with channel IDs) or invite the Slack bot to a channel",
      }, { status: 400 });
    }

    // ── Step 6: Send test message ───────────────────────────────────────
    let sendResult: unknown = null;
    try {
      const resp = await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://slack.com",
        endpoint: "/api/chat.postMessage",
        connectionId,
        providerConfigKey: "slack",
        data: {
          channel: targetChannel,
          text: `:white_check_mark: *Test message from Skyler*\nThis is a test notification sent at ${new Date().toISOString()}.\nIf you see this, Slack notifications are working!`,
          unfurl_links: false,
          unfurl_media: false,
        },
      });
      sendResult = resp.data;
      steps.sendMessage = { status: "ok", data: sendResult };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      steps.sendMessage = {
        status: "error",
        statusCode: e.response?.status,
        responseBody: e.response?.data,
        message: e.message,
      };
      return NextResponse.json({ steps, error: "chat.postMessage failed" }, { status: 500 });
    }

    // ── Step 7: Diagnose the result ─────────────────────────────────────
    const slackOk = (sendResult as Record<string, unknown>)?.ok;
    const slackError = (sendResult as Record<string, unknown>)?.error;

    return NextResponse.json({
      status: slackOk ? "ok" : "failed",
      slackApiOk: slackOk,
      slackApiError: slackError ?? null,
      sentTo: { channel: targetChannel, name: targetName },
      steps,
      diagnosis: slackOk
        ? "Message sent successfully! If you don't see it in Slack, check the channel."
        : slackError === "channel_not_found"
        ? "PROBLEM: Channel ID is invalid or bot was removed from it"
        : slackError === "not_in_channel"
        ? "PROBLEM: Bot is not a member of this channel — invite it with /invite @BotName"
        : slackError === "invalid_auth"
        ? "PROBLEM: Slack token is invalid — reconnect Slack in Integrations"
        : `PROBLEM: Slack API returned error: ${slackError}`,
    });
  } catch (err) {
    return NextResponse.json({
      steps,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}

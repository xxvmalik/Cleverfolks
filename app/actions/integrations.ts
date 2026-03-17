"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";
import { createRecallCalendar } from "@/lib/recall/client";

/**
 * Called after Nango ConnectUI fires a 'connect' event.
 * Saves the connection then immediately fires the first background sync.
 */
export async function connectIntegrationAction(
  workspaceId: string,
  provider: string,
  nangoConnectionId: string
) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized" };
  }

  // Upsert the integration row
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .single();

  let integrationId: string | null = null;

  if (existing) {
    await supabase
      .from("integrations")
      .update({
        status: "connected",
        nango_connection_id: nangoConnectionId,
        sync_status: "syncing",
        sync_error: null,
      })
      .eq("id", existing.id);
    integrationId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("integrations")
      .insert({
        workspace_id: workspaceId,
        provider,
        status: "connected",
        nango_connection_id: nangoConnectionId,
        sync_status: "syncing",
      })
      .select("id")
      .single();

    if (error) return { error: error.message, integrationId: null };
    integrationId = inserted?.id ?? null;
  }

  if (!integrationId) return { error: "Failed to save integration", integrationId: null };

  // Fire the first sync immediately as a background job
  await inngest.send({
    name: "integration/sync.requested",
    data: { workspaceId, integrationId, provider, connectionId: nangoConnectionId, windowKey: String(Math.floor(Date.now() / (15 * 60 * 1000))) },
  });

  // For calendar providers, wire refresh token to Recall AI Calendar V2
  if (provider === "google-calendar" || provider === "outlook") {
    wireCalendarToRecall(workspaceId, provider, nangoConnectionId).catch((err) => {
      console.error("[integrations] Recall calendar connect failed:", err instanceof Error ? err.message : err);
    });
  }

  return { error: null, integrationId };
}

/**
 * Disconnects an integration: deletes the Nango connection then updates DB.
 */
export async function disconnectIntegrationAction(integrationId: string) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized" };
  }

  const { data: integration } = await supabase
    .from("integrations")
    .select("nango_connection_id, provider")
    .eq("id", integrationId)
    .single();

  // Delete from Nango (best-effort)
  if (integration?.nango_connection_id) {
    try {
      await fetch(
        `https://api.nango.dev/connection/${encodeURIComponent(integration.nango_connection_id)}?provider_config_key=${encodeURIComponent(integration.provider)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.NANGO_SECRET_KEY}` },
        }
      );
    } catch (err) {
      console.error("Failed to delete Nango connection:", err);
    }
  }

  const { error } = await supabase
    .from("integrations")
    .update({ status: "disconnected", nango_connection_id: null, sync_status: "idle" })
    .eq("id", integrationId);

  return { error: error?.message ?? null };
}

// ── Recall AI Calendar V2 wiring ──────────────────────────────────────────────

const NANGO_API_URL = "https://api.nango.dev";

const CALENDAR_PROVIDER_MAP: Record<string, {
  recallPlatform: "google_calendar" | "microsoft_outlook";
  dbProvider: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}> = {
  "google-calendar": {
    recallPlatform: "google_calendar",
    dbProvider: "google",
    clientIdEnv: "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CALENDAR_CLIENT_SECRET",
  },
  outlook: {
    recallPlatform: "microsoft_outlook",
    dbProvider: "outlook",
    clientIdEnv: "OUTLOOK_CLIENT_ID",
    clientSecretEnv: "OUTLOOK_CLIENT_SECRET",
  },
};

/**
 * After a calendar provider is connected via Nango, extract the refresh token
 * and register it with Recall AI Calendar V2 for meeting detection.
 */
async function wireCalendarToRecall(
  workspaceId: string,
  provider: string,
  nangoConnectionId: string
): Promise<void> {
  const config = CALENDAR_PROVIDER_MAP[provider];
  if (!config) return;

  const db = createAdminSupabaseClient();

  // Check if already wired
  const { data: existing } = await db
    .from("recall_calendars")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", config.dbProvider)
    .single();

  if (existing) {
    console.log(`[calendar-recall] Already connected for ${provider} in workspace ${workspaceId}`);
    return;
  }

  // Fetch refresh token from Nango
  const nangoRes = await fetch(
    `${NANGO_API_URL}/connection/${encodeURIComponent(nangoConnectionId)}?provider_config_key=${encodeURIComponent(provider)}`,
    { headers: { Authorization: `Bearer ${process.env.NANGO_SECRET_KEY}` } }
  );

  if (!nangoRes.ok) {
    throw new Error(`Nango connection fetch failed: ${nangoRes.status}`);
  }

  const nangoConnection = await nangoRes.json();
  const refreshToken = nangoConnection.credentials?.refresh_token;

  if (!refreshToken) {
    throw new Error("No refresh_token in Nango connection");
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    console.warn(`[calendar-recall] Missing env: ${config.clientIdEnv} or ${config.clientSecretEnv} — skipping Recall`);
    return;
  }

  // Create calendar in Recall AI
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`
    : undefined;

  const recallCalendar = await createRecallCalendar({
    platform: config.recallPlatform,
    oauthRefreshToken: refreshToken,
    oauthClientId: clientId,
    oauthClientSecret: clientSecret,
    webhookUrl,
  });

  console.log(`[calendar-recall] Created: ${recallCalendar.id} (${config.recallPlatform})`);

  // Store in recall_calendars
  await db.from("recall_calendars").insert({
    workspace_id: workspaceId,
    recall_calendar_id: recallCalendar.id,
    provider: config.dbProvider,
    platform_email: recallCalendar.platform_email ?? null,
    status: "connected",
  });

  // Update workspace meeting settings
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;
  const currentMeeting = (currentSettings.skyler_meeting ?? {}) as Record<string, unknown>;

  await db
    .from("workspaces")
    .update({
      settings: {
        ...currentSettings,
        skyler_meeting: {
          ...currentMeeting,
          calendarConnected: true,
          calendarProvider: config.dbProvider,
          calendarEmail: recallCalendar.platform_email ?? "",
        },
      },
    })
    .eq("id", workspaceId);
}

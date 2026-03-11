"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { inngest } from "@/lib/inngest/client";

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

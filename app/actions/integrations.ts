"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Called after Nango ConnectUI fires a 'connect' event.
 * Stores the real connection ID returned by Nango.
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

  // Check if integration already exists
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("integrations")
      .update({
        status: "connected",
        nango_connection_id: nangoConnectionId,
      })
      .eq("id", existing.id);

    return { error: error?.message ?? null, integrationId: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from("integrations")
    .insert({
      workspace_id: workspaceId,
      provider,
      status: "connected",
      nango_connection_id: nangoConnectionId,
    })
    .select("id")
    .single();

  return { error: error?.message ?? null, integrationId: inserted?.id ?? null };
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

  // Fetch the integration to get the nango_connection_id + provider
  const { data: integration } = await supabase
    .from("integrations")
    .select("nango_connection_id, provider")
    .eq("id", integrationId)
    .single();

  // Delete the connection from Nango (best-effort)
  if (integration?.nango_connection_id) {
    try {
      await fetch(
        `https://api.nango.dev/connection/${encodeURIComponent(integration.nango_connection_id)}?provider_config_key=${encodeURIComponent(integration.provider)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${process.env.NANGO_SECRET_KEY}`,
          },
        }
      );
    } catch (err) {
      console.error("Failed to delete Nango connection:", err);
    }
  }

  const { error } = await supabase
    .from("integrations")
    .update({ status: "disconnected", nango_connection_id: null })
    .eq("id", integrationId);

  return { error: error?.message ?? null };
}

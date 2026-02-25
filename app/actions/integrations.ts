"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function connectIntegrationAction(
  workspaceId: string,
  provider: string
) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized" };
  }

  const nangoConnectionId = `${provider}_${workspaceId}`;

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

    return { error: error?.message ?? null };
  }

  const { error } = await supabase.from("integrations").insert({
    workspace_id: workspaceId,
    provider,
    status: "connected",
    nango_connection_id: nangoConnectionId,
  });

  return { error: error?.message ?? null };
}

export async function disconnectIntegrationAction(integrationId: string) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized" };
  }

  const { error } = await supabase
    .from("integrations")
    .update({ status: "disconnected" })
    .eq("id", integrationId);

  return { error: error?.message ?? null };
}

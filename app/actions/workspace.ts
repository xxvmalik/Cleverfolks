"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createWorkspace } from "@/lib/workspace";

export async function createWorkspaceAction(
  name: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated. Please sign in again." };
  }

  const { error } = await createWorkspace(supabase, name);

  if (error) {
    return { error: error.message };
  }

  return {};
}

/**
 * Merge a partial settings patch into workspaces.settings for the given workspace.
 * Requires the calling user to be a workspace member.
 */
export async function updateWorkspaceSettingsAction(
  workspaceId: string,
  patch: Record<string, unknown>
): Promise<{ error?: string }> {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();
  if (userError || !user) return { error: "Not authenticated" };

  const { data: membership } = await authClient
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (!membership) return { error: "Forbidden" };

  const admin = createAdminSupabaseClient();

  // Fetch current settings so we can merge rather than overwrite
  const { data: ws } = await admin
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const currentSettings = (ws?.settings as Record<string, unknown>) ?? {};
  const newSettings = { ...currentSettings, ...patch };

  const { error } = await admin
    .from("workspaces")
    .update({ settings: newSettings })
    .eq("id", workspaceId);

  if (error) return { error: error.message };
  return {};
}

"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createWorkspace } from "@/lib/workspace";

const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

/**
 * Set the active workspace cookie. Used after workspace creation or switching.
 * Validates the user is a member of the workspace before setting.
 */
export async function setActiveWorkspaceAction(
  workspaceId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify membership
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return { error: "Not a member of this workspace" };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return {};
}

/**
 * Read the active workspace ID from the cookie. Server-only.
 */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

export async function createWorkspaceAction(
  name: string
): Promise<{ error?: string; workspaceId?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated. Please sign in again." };
  }

  const { data: workspaceId, error } = await createWorkspace(supabase, name);

  if (error) {
    return { error: error.message };
  }

  if (!workspaceId) {
    // RPC succeeded but returned no ID — workspace wasn't actually created
    // Fall back to direct insert via admin client
    console.error("[create-workspace] RPC returned no workspace ID — falling back to direct insert");
    const admin = createAdminSupabaseClient();
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");

    const { data: inserted, error: insertErr } = await admin
      .from("workspaces")
      .insert({ name, slug })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return { error: insertErr?.message ?? "Failed to create workspace" };
    }

    // Create membership for the user
    const { error: memberErr } = await admin
      .from("workspace_memberships")
      .insert({ workspace_id: inserted.id, user_id: user.id, role: "owner" });

    if (memberErr) {
      return { error: memberErr.message };
    }

    return { workspaceId: inserted.id };
  }

  // Verify the workspace actually exists
  const { data: verified } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .single();

  if (!verified) {
    return { error: "Workspace creation appeared to succeed but workspace not found. Please try again." };
  }

  return { workspaceId };
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

import type { SupabaseClient } from "@supabase/supabase-js";

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createWorkspace(
  client: SupabaseClient,
  name: string,
  userId: string
) {
  const slug = generateSlug(name);

  const { data: workspace, error: workspaceError } = await client
    .from("workspaces")
    .insert({ name, slug, owner_id: userId })
    .select()
    .single();

  if (workspaceError) return { data: null, error: workspaceError };

  const { error: memberError } = await client
    .from("workspace_memberships")
    .insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) return { data: null, error: memberError };

  return { data: workspace, error: null };
}

export async function getUserWorkspaces(client: SupabaseClient, userId: string) {
  return client
    .from("workspace_memberships")
    .select("role, workspaces(id, name, slug)")
    .eq("user_id", userId);
}

export async function getWorkspaceMembers(
  client: SupabaseClient,
  workspaceId: string
) {
  return client
    .from("workspace_memberships")
    .select("role, user_id, profiles(id, full_name, email, avatar_url)")
    .eq("workspace_id", workspaceId);
}

export async function inviteTeamMember(
  client: SupabaseClient,
  workspaceId: string,
  email: string,
  role: string
) {
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    return { data: null, error: { message: "No user found with that email address." } };
  }

  return client
    .from("workspace_memberships")
    .insert({ workspace_id: workspaceId, user_id: profile.id, role });
}

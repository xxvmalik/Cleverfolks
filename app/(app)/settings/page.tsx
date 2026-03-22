import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);
  if (!memberships?.length) redirect("/create-workspace");

  const ws = memberships[0].workspaces as unknown as {
    id: string;
    name: string;
  };

  // Load user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .eq("id", user.id)
    .single();

  // Load workspace settings for team data
  const { data: wsData } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", ws.id)
    .single();

  const settings = (wsData?.settings ?? {}) as Record<string, unknown>;
  const teamData = (settings.team ?? {}) as Record<string, unknown>;

  // Load team members
  const { data: members } = await supabase
    .from("workspace_memberships")
    .select("role, user_id, profiles(id, full_name, email, avatar_url)")
    .eq("workspace_id", ws.id);

  return (
    <SettingsClient
      workspaceId={ws.id}
      workspaceName={ws.name}
      userProfile={{
        id: user.id,
        email: user.email ?? profile?.email ?? "",
        fullName: profile?.full_name ?? user.user_metadata?.full_name ?? "",
        avatarUrl: profile?.avatar_url ?? user.user_metadata?.avatar_url ?? "",
      }}
      teamSettings={{
        role: (teamData.role as string) ?? "",
        timezone: (teamData.timezone as string) ?? "",
        workingHoursStart: (teamData.working_hours_start as string) ?? "09:00",
        workingHoursEnd: (teamData.working_hours_end as string) ?? "17:00",
        language: (teamData.language as string) ?? "English",
      }}
      members={(members ?? []).map((m) => {
        const p = m.profiles as unknown as { id: string; full_name: string | null; email: string; avatar_url: string | null } | null;
        return {
          id: p?.id ?? m.user_id,
          name: p?.full_name ?? "Unknown",
          email: p?.email ?? "",
          role: m.role,
          avatarUrl: p?.avatar_url ?? null,
        };
      })}
    />
  );
}

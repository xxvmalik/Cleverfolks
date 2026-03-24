import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { WorkspaceProvider } from "@/context/workspace-context";
import { getActiveWorkspaceId } from "@/app/actions/workspace";
import type { Workspace } from "@/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);

  if (!memberships || memberships.length === 0) redirect("/create-workspace");

  const workspaces: Workspace[] = memberships
    .filter((m) => m.workspaces)
    .map((m) => {
      const ws = m.workspaces as unknown as {
        id: string;
        name: string;
        slug: string;
        onboarding_completed: boolean;
        skyler_onboarding_completed: boolean;
      };
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        role: m.role,
        onboarding_completed: ws.onboarding_completed,
        skyler_onboarding_completed: ws.skyler_onboarding_completed,
      };
    });

  // Determine active workspace from cookie, fallback to first
  const activeWsId = await getActiveWorkspaceId();
  const activeWs = activeWsId
    ? workspaces.find((w) => w.id === activeWsId)
    : null;

  // Sort workspaces so active one is first (WorkspaceProvider uses [0] as default)
  const sortedWorkspaces = activeWs
    ? [activeWs, ...workspaces.filter((w) => w.id !== activeWs.id)]
    : workspaces;

  const current = sortedWorkspaces[0];

  // If general onboarding not completed for active workspace, redirect to the wizard
  if (current && !current.onboarding_completed) {
    redirect("/onboarding");
  }

  // If Skyler onboarding not completed for active workspace, redirect to Skyler setup
  if (current && !current.skyler_onboarding_completed) {
    redirect("/onboarding/skyler");
  }

  return (
    <WorkspaceProvider workspaces={sortedWorkspaces}>
      {children}
    </WorkspaceProvider>
  );
}

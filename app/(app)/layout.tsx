import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { WorkspaceProvider } from "@/context/workspace-context";
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

  // If general onboarding not completed, redirect to the wizard
  if (workspaces.length > 0 && !workspaces[0].onboarding_completed) {
    redirect("/onboarding");
  }

  // If Skyler onboarding not completed, redirect to Skyler setup
  if (workspaces.length > 0 && !workspaces[0].skyler_onboarding_completed) {
    redirect("/onboarding/skyler");
  }

  return (
    <WorkspaceProvider workspaces={workspaces}>
      {children}
    </WorkspaceProvider>
  );
}

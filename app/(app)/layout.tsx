import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { WorkspaceProvider } from "@/context/workspace-context";
import { Sidebar } from "@/components/sidebar";
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

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);

  if (!memberships || memberships.length === 0) {
    redirect("/create-workspace");
  }

  const workspaces: Workspace[] = memberships
    .filter((m) => m.workspaces)
    .map((m) => {
      const ws = m.workspaces as unknown as { id: string; name: string; slug: string };
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        role: m.role,
      };
    });

  return (
    <WorkspaceProvider workspaces={workspaces}>
      <div className="flex h-screen overflow-hidden bg-[#131619]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-[#1C1F24]">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { IntegrationsClient } from "@/components/integrations/integrations-client";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);
  if (!memberships || memberships.length === 0) redirect("/create-workspace");

  const ws = memberships[0].workspaces as unknown as {
    id: string;
    name: string;
    slug: string;
    onboarding_completed: boolean;
  };

  const { data: integrations } = await supabase
    .from("integrations")
    .select("*")
    .eq("workspace_id", ws.id);

  return (
    <IntegrationsClient
      integrations={integrations ?? []}
      workspaceId={ws.id}
    />
  );
}

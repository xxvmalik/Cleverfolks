import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { SkylerClient } from "@/components/skyler/skyler-client";

export const metadata = { title: "Skyler — Sales Assistant" };

export default async function SkylerPage() {
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
  };

  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split("@")[0] ??
    "User";

  return (
    <SkylerClient
      workspaceId={ws.id}
      userName={displayName}
      companyName={ws.name}
    />
  );
}

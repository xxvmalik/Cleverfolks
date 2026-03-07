import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { CleverBrainClient } from "@/components/cleverbrain/cleverbrain-client";

export const metadata = { title: "CleverBrain" };

export default async function CleverBrainPage() {
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

  // Get user display name
  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split("@")[0] ??
    "User";

  return (
    <CleverBrainClient
      workspaceId={ws.id}
      userName={displayName}
      companyName={ws.name}
    />
  );
}

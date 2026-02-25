import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";

type Props = {
  searchParams: Promise<{ step?: string }>;
};

export default async function OnboardingPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);
  if (!memberships?.length) redirect("/create-workspace");

  const ws = memberships[0].workspaces as unknown as {
    id: string;
    name: string;
    slug: string;
    onboarding_completed: boolean;
  };

  if (ws.onboarding_completed) redirect("/");

  // Load saved onboarding state
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("workspace_id", ws.id)
    .maybeSingle();

  const orgData = (state?.org_data ?? {}) as Record<string, unknown>;
  const skylerData = (state?.skyler_data ?? {}) as Record<string, unknown>;

  // Resolve step
  const stepParam = params.step;
  let step: number | string;
  if (stepParam === "phase1done" || stepParam === "done") {
    step = stepParam;
  } else if (stepParam) {
    step = Math.min(Math.max(parseInt(stepParam) || 1, 1), 14);
  } else {
    step = state?.current_step ?? 1;
  }

  return (
    <OnboardingShell
      step={step}
      workspaceId={ws.id}
      workspaceName={ws.name}
      orgData={orgData}
      skylerData={skylerData}
    />
  );
}

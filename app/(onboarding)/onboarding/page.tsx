import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { resolveActiveWorkspace } from "@/lib/active-workspace";
import { GeneralOnboardingShell } from "@/components/onboarding/general-onboarding-shell";

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

  const ws = await resolveActiveWorkspace(memberships);

  // General onboarding already done — go to Skyler or dashboard
  if (ws.onboarding_completed) {
    if (!ws.skyler_onboarding_completed) redirect("/onboarding/skyler");
    redirect("/");
  }

  // Load saved onboarding state
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("workspace_id", ws.id)
    .maybeSingle();

  const orgData = (state?.org_data ?? {}) as Record<string, unknown>;

  // Load connected integrations from DB
  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider")
    .eq("workspace_id", ws.id)
    .eq("status", "connected");
  const connectedProviders = (integrations ?? []).map((i) => i.provider);

  // Resolve step (1-7 for general onboarding)
  const stepParam = params.step;
  let step: number | string;
  if (stepParam === "phase1done") {
    step = stepParam;
  } else if (stepParam) {
    step = Math.min(Math.max(parseInt(stepParam) || 1, 1), 7);
  } else {
    step = Math.min(state?.current_step ?? 1, 7);
  }

  return (
    <GeneralOnboardingShell
      step={step}
      workspaceId={ws.id}
      workspaceName={ws.name}
      orgData={orgData}
      connectedProviders={connectedProviders}
    />
  );
}

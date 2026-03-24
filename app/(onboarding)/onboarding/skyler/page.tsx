import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getUserWorkspaces } from "@/lib/workspace";
import { getActiveWorkspaceId } from "@/app/actions/workspace";
import { SkylerOnboardingShell } from "@/components/onboarding/skyler-onboarding-shell";

type Props = {
  searchParams: Promise<{ step?: string }>;
};

export default async function SkylerOnboardingPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await getUserWorkspaces(supabase, user.id);
  if (!memberships?.length) redirect("/create-workspace");

  // Find the active workspace from cookie, fallback to first
  const activeWsId = await getActiveWorkspaceId();
  const allWorkspaces = memberships
    .filter((m) => m.workspaces)
    .map((m) => m.workspaces as unknown as {
      id: string;
      name: string;
      slug: string;
      onboarding_completed: boolean;
      skyler_onboarding_completed: boolean;
    });

  const ws = allWorkspaces.find((w) => w.id === activeWsId) ?? allWorkspaces[0];

  // General onboarding must be completed first
  if (!ws.onboarding_completed) redirect("/onboarding");

  // Already done
  if (ws.skyler_onboarding_completed) redirect("/");

  // Load saved onboarding state
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("workspace_id", ws.id)
    .maybeSingle();

  const skylerData = (state?.skyler_data ?? {}) as Record<string, unknown>;

  // Load workspace settings for pre-fill
  const { data: wsData } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", ws.id)
    .single();

  const settings = (wsData?.settings ?? {}) as Record<string, unknown>;

  // Load connected integrations for tools step
  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, status")
    .eq("workspace_id", ws.id);

  const connectedProviders = (integrations ?? [])
    .filter((i: { status: string }) => i.status === "active")
    .map((i: { provider: string }) => i.provider);

  // Resolve step (1-7 for Skyler onboarding)
  const stepParam = params.step;
  let step: number | string;
  if (stepParam === "done") {
    step = stepParam;
  } else if (stepParam) {
    step = Math.min(Math.max(parseInt(stepParam) || 1, 1), 7);
  } else {
    // Default: resume from saved progress
    const savedStep = state?.current_step ?? 1;
    step = savedStep > 7 ? savedStep - 7 : 1;
  }

  return (
    <SkylerOnboardingShell
      step={step}
      workspaceId={ws.id}
      workspaceName={ws.name}
      skylerData={skylerData}
      workspaceSettings={settings}
      connectedProviders={connectedProviders}
    />
  );
}

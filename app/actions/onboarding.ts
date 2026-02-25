"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function saveOnboardingStepAction({
  workspaceId,
  step,
  orgData,
  skylerData,
}: {
  workspaceId: string;
  step: number;
  orgData?: Record<string, unknown>;
  skylerData?: Record<string, unknown>;
}): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { error: "Not authenticated" };

  const { error } = await supabase.rpc("upsert_onboarding_state", {
    p_workspace_id: workspaceId,
    p_org_data: orgData ?? null,
    p_skyler_data: skylerData ?? null,
    p_current_step: step,
  });

  if (error) return { error: error.message };
  return {};
}

export async function completeOnboardingAction(
  workspaceId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { error: "Not authenticated" };

  const { error } = await supabase.rpc("complete_onboarding", {
    p_workspace_id: workspaceId,
  });

  if (error) return { error: error.message };
  return {};
}

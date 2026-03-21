"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Save a single onboarding step (general or skyler) ──────────────────────

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

// ── Complete General Onboarding (phase 1) ──────────────────────────────────

export async function completeGeneralOnboardingAction(
  workspaceId: string,
  allOrgData: Record<string, unknown>
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { error: "Not authenticated" };

  const db = createAdminSupabaseClient();

  // Build structured settings from org data
  const step1 = (allOrgData.step1 ?? {}) as Record<string, unknown>;
  const step2 = (allOrgData.step2 ?? {}) as Record<string, unknown>;
  const step3 = (allOrgData.step3 ?? {}) as Record<string, unknown>;
  const step4 = (allOrgData.step4 ?? {}) as Record<string, unknown>;
  const step5 = (allOrgData.step5 ?? {}) as Record<string, unknown>;
  const step7 = (allOrgData.step7 ?? {}) as Record<string, unknown>;

  const businessProfile = {
    company_name: step1.companyName ?? "",
    website: step1.companyWebsite ?? "",
    company_description: step1.companyDescription ?? "",
    industry: step1.industry ?? "",
    company_stage: step1.companyStage ?? "",
    team_size: step1.teamSize ?? "",
    business_model: step2.businessModel ?? "",
    target_audience: step2.targetAudience ?? "",
    differentiator: step2.differentiator ?? "",
  };

  const competitors = ((step2.competitors ?? []) as string[]).map((name) => ({
    id: crypto.randomUUID(),
    name,
  }));

  const brand = {
    voice: step3.brandVoice ?? "",
    tagline: step3.tagline ?? "",
    colors: {
      primary: step3.primaryColor ?? "#4A6CF7",
      secondary: step3.secondaryColor ?? "#1A1A2E",
      accent: step3.accentColor ?? "#10B981",
    },
    fonts: {
      heading: step3.headingFont ?? "",
      body: step3.bodyFont ?? "",
    },
  };

  const products = (step4.products ?? []) as Array<{
    name?: string;
    description?: string;
    pricing_model?: string;
  }>;

  const team = {
    role: step5.role ?? "",
    primary_timezone: step5.timezone ?? "",
    working_hours: {
      start: step5.workingHoursStart ?? "09:00",
      end: step5.workingHoursEnd ?? "18:00",
    },
    primary_language: step5.language ?? "en",
  };

  const goals = {
    focus_areas: step7.focusAreas ?? [],
    biggest_bottleneck: step7.bottleneck ?? "",
  };

  const onboardingStatus = {
    general_completed: true,
    general_completed_at: new Date().toISOString(),
    general_steps_completed: ["company", "market", "brand", "products", "team", "tools", "goals"],
    skyler_completed: false,
  };

  // Read current settings and merge
  const { data: ws } = await db
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;

  const mergedSettings = {
    ...currentSettings,
    business_profile: businessProfile,
    competitors,
    brand,
    products,
    team,
    goals,
    onboarding_status: onboardingStatus,
    // Also set flat keys for backwards compat with system prompt builder
    company_name: businessProfile.company_name,
    description: businessProfile.company_description,
    industry: businessProfile.industry,
  };

  // Update workspace settings + name + onboarding_completed
  const { error: updateError } = await db
    .from("workspaces")
    .update({
      settings: mergedSettings,
      name: businessProfile.company_name || undefined,
      onboarding_completed: true,
    })
    .eq("id", workspaceId);

  if (updateError) return { error: updateError.message };

  // Mark onboarding_state as completed
  await db
    .from("onboarding_state")
    .update({ completed_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);

  return {};
}

// ── Complete Skyler Onboarding (phase 2) ───────────────────────────────────

export async function completeSkylerOnboardingAction(
  workspaceId: string,
  allSkylerData: Record<string, unknown>,
  sharedFieldUpdates?: Record<string, unknown>
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { error: "Not authenticated" };

  const db = createAdminSupabaseClient();

  // Build Skyler agent config from step data
  const s1 = (allSkylerData.step1 ?? {}) as Record<string, unknown>;
  const s2 = (allSkylerData.step2 ?? {}) as Record<string, unknown>;
  const s3 = (allSkylerData.step3 ?? {}) as Record<string, unknown>;
  const s4 = (allSkylerData.step4 ?? {}) as Record<string, unknown>;
  const s6 = (allSkylerData.step6 ?? {}) as Record<string, unknown>;

  const skylerConfig = {
    // Step 1: Business
    ideal_customer: s1.idealCustomer ?? "",
    primary_pain_point: s1.primaryPain ?? "",
    primary_outcome: s1.primaryOutcome ?? "",

    // Step 2: Sales Process
    sales_journey: s2.salesJourney ?? "",
    cycle_length: s2.cycleLength ?? "",
    pricing_structure: s2.pricingStructure ?? "",
    average_deal_size: s2.averageDealSize ?? "",
    outreach_goal: s2.outreachGoal ?? "",

    // Step 3: Objections
    general_objections: s3.objections ?? [],
    never_say_about_competitors: s3.neverSay ?? "",

    // Step 4: Tone
    formality_level: s4.formalityLevel ?? "conversational",
    communication_approach: s4.communicationApproach ?? "consultative",
    phrases_always_use: s4.phrasesAlwaysUse ?? [],
    phrases_never_use: s4.phrasesNeverUse ?? [],

    // Step 6: Guardrails
    autonomy: {
      auto_send_followups: s6.autoSendFollowups ?? true,
      auto_handle_objections: s6.autoHandleObjections ?? true,
      auto_book_demos: s6.autoBookDemos ?? false,
      auto_send_first_outreach: s6.autoSendFirstOutreach ?? false,
    },
    confidence_thresholds: {
      auto_execute: 85,
      draft_for_review: 60,
    },
    contact_hours: {
      start: s6.contactHoursStart ?? "08:00",
      end: s6.contactHoursEnd ?? "18:00",
      timezone: "prospect",
    },
    hard_rules: [
      "escalate_ready_to_buy",
      "escalate_legal_mentions",
      "stop_on_unsubscribe",
      "never_below_minimum_price",
    ],

    // Also map to SkylerWorkflowSettings shape for backwards compat
    primaryGoal: s2.outreachGoal ?? "Book demos",
    salesJourney: s2.salesJourney ?? "",
    pricingStructure: s2.pricingStructure ?? "",
    averageSalesCycle: s2.cycleLength ?? "",
    averageDealSize: s2.averageDealSize ?? "",
    formality: s4.formalityLevel ?? "conversational",
    communicationApproach: s4.communicationApproach ?? "consultative",
    phrasesToAlwaysUse: s4.phrasesAlwaysUse ?? [],
    phrasesToNeverUse: s4.phrasesNeverUse ?? [],
    autonomyToggles: {
      sendFollowUps: s6.autoSendFollowups ?? true,
      handleObjections: s6.autoHandleObjections ?? true,
      bookMeetings: s6.autoBookDemos ?? false,
      firstOutreachApproval: !(s6.autoSendFirstOutreach ?? false),
    },
  };

  // Upsert into agent_configurations
  const { error: configError } = await db
    .from("agent_configurations")
    .upsert(
      {
        workspace_id: workspaceId,
        agent_type: "skyler",
        config: skylerConfig,
        onboarding_completed_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,agent_type" }
    );

  if (configError) return { error: configError.message };

  // Write back any edited shared fields to workspace settings
  if (sharedFieldUpdates && Object.keys(sharedFieldUpdates).length > 0) {
    const { data: ws } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();

    const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;
    const bp = (currentSettings.business_profile ?? {}) as Record<string, unknown>;

    const updatedBp = { ...bp, ...sharedFieldUpdates };
    const updatedSettings = {
      ...currentSettings,
      business_profile: updatedBp,
      // Also update flat keys
      ...(sharedFieldUpdates.company_description
        ? { description: sharedFieldUpdates.company_description }
        : {}),
    };

    await db
      .from("workspaces")
      .update({ settings: updatedSettings })
      .eq("id", workspaceId);
  }

  // Also write skyler config to workspaces.settings.skyler_workflow for backwards compat
  {
    const { data: ws } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();
    const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;

    const onboardingStatus = (currentSettings.onboarding_status ?? {}) as Record<string, unknown>;
    const updatedStatus = {
      ...onboardingStatus,
      skyler_completed: true,
      skyler_completed_at: new Date().toISOString(),
      skyler_steps_completed: [
        "business",
        "sales_process",
        "objections",
        "tone",
        "tools",
        "guardrails",
        "review",
      ],
    };

    await db
      .from("workspaces")
      .update({
        settings: {
          ...currentSettings,
          skyler_workflow: skylerConfig,
          onboarding_status: updatedStatus,
        },
        skyler_onboarding_completed: true,
      })
      .eq("id", workspaceId);
  }

  // Also update competitor data with Skyler-specific fields
  if (s3.competitorAdvantages) {
    const { data: ws } = await db
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();
    const currentSettings = (ws?.settings ?? {}) as Record<string, unknown>;
    const competitors = (currentSettings.competitors ?? []) as Array<Record<string, unknown>>;

    // Merge Skyler-specific data into competitor entries
    const updatedCompetitors = competitors.map((c) => ({
      ...c,
      advantages: s3.competitorAdvantages,
      skyler_objection_responses: s3.objections ?? [],
      skyler_never_say: s3.neverSay ? [s3.neverSay] : [],
    }));

    await db
      .from("workspaces")
      .update({
        settings: { ...currentSettings, competitors: updatedCompetitors },
      })
      .eq("id", workspaceId);
  }

  // Fire Inngest event for background jobs
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "workspace/onboarding.completed",
      data: { workspaceId },
    });
  } catch {
    // Non-blocking — background jobs will be retried
    console.error("Failed to fire onboarding completion event");
  }

  return {};
}

// ── Legacy: Complete onboarding (kept for backwards compat) ────────────────

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

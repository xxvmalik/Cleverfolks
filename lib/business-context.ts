/**
 * Shared Business Context Service
 *
 * Assembles a compact (~1,500 token) business context document from:
 * - Onboarding data (company name, industry, ICP, products, competitors, team size, tone)
 * - Knowledge profile (auto-generated from synced data)
 * - Connector summaries (which integrations are connected)
 * - Agent status (which agents are subscribed and active)
 *
 * This document is injected into every agent's system prompt as the "Layer 1"
 * of shared context. Both CleverBrain and Skyler get the same foundation.
 */

import type { IntegrationInfo } from "@/lib/integrations-manifest";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BusinessContextInput = {
  workspace: { name: string; settings: Record<string, unknown> | null } | null;
  onboarding: {
    org_data: Record<string, unknown> | null;
    skyler_data: Record<string, unknown> | null;
  } | null;
  knowledgeProfile: {
    profile: Record<string, unknown> | null;
    status: string | null;
  } | null;
  connectedIntegrations: IntegrationInfo[];
  activeAgents?: string[]; // e.g. ["skyler"]
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim()) return val.trim();
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function get(obj: Record<string, unknown>, path: string): any {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildBusinessContext(input: BusinessContextInput): string {
  const settings = input.workspace?.settings ?? {};
  const orgData = input.onboarding?.org_data ?? {};
  const skylerData = input.onboarding?.skyler_data ?? {};
  const bp = (settings.business_profile ?? {}) as Record<string, unknown>;

  const sections: string[] = [];

  // ── Company identity ────────────────────────────────────────────────────────
  const companyName =
    str(bp.company_name) ??
    str(settings.company_name) ??
    str(get(orgData, "step1.companyName")) ??
    str(input.workspace?.name) ??
    "Unknown Company";

  const identity: string[] = [`Company: ${companyName}`];

  const description =
    str(bp.company_description) ??
    str(settings.description) ??
    str(get(skylerData, "step8.companyOverview"));
  if (description) identity.push(`Description: ${description}`);

  const industry =
    str(bp.industry) ??
    str(settings.industry) ??
    str(get(orgData, "step1.industry"));
  if (industry && industry !== "Other") identity.push(`Industry: ${industry}`);

  const companyStage = str(bp.company_stage) ?? str(get(orgData, "step1.companyStage"));
  if (companyStage) identity.push(`Stage: ${companyStage}`);

  const teamSize = str(bp.team_size) ?? str(get(settings, "team.size")) ?? str(get(orgData, "step5.teamSize"));
  if (teamSize) identity.push(`Team size: ${teamSize}`);

  const businessModel = str(bp.business_model) ?? str(get(orgData, "step1.businessModel"));
  if (businessModel) identity.push(`Business model: ${businessModel}`);

  const website = str(bp.website) ?? str(get(orgData, "step1.website"));
  if (website) identity.push(`Website: ${website}`);

  sections.push(identity.join("\n"));

  // ── Products & services ─────────────────────────────────────────────────────
  const rawProducts = (settings.products ?? get(orgData, "step4.products") ?? []) as Array<{
    name?: string;
    description?: string;
    pricing_model?: string;
  }>;
  const productLines = rawProducts
    .filter((p) => p.name?.trim())
    .map((p) => {
      let line = `- ${p.name}`;
      if (p.description?.trim()) line += `: ${p.description.trim()}`;
      if (p.pricing_model?.trim()) line += ` (${p.pricing_model.trim()})`;
      return line;
    });
  if (productLines.length > 0) {
    sections.push(`Products/Services:\n${productLines.join("\n")}`);
  }

  // ── Target market ───────────────────────────────────────────────────────────
  const market: string[] = [];

  const targetAudience =
    str(bp.target_audience) ??
    str(get(orgData, "step2.targetAudience")) ??
    str(get(skylerData, "step8.idealCustomerProfile"));
  if (targetAudience) market.push(`Target customers: ${targetAudience}`);

  const positioning =
    str(bp.differentiator) ??
    str(get(orgData, "step2.positioning")) ??
    str(get(skylerData, "step8.uniqueValueProp"));
  if (positioning) market.push(`Differentiator: ${positioning}`);

  if (market.length > 0) sections.push(market.join("\n"));

  // ── Competitors ─────────────────────────────────────────────────────────────
  const rawCompetitors = (settings.competitors ?? []) as Array<{
    name?: string;
    advantages?: string;
  }>;
  const competitorNames = rawCompetitors
    .filter((c) => c.name?.trim())
    .map((c) => {
      let line = c.name!;
      if (c.advantages?.trim()) line += ` (${c.advantages.trim()})`;
      return line;
    });
  if (competitorNames.length > 0) {
    sections.push(`Competitors: ${competitorNames.join("; ")}`);
  }

  // ── Brand & tone ────────────────────────────────────────────────────────────
  const brand = (settings.brand ?? {}) as Record<string, unknown>;
  const brandParts: string[] = [];

  const voice = str(brand.voice) ?? str(get(orgData, "step3.brandVoice"));
  if (voice) brandParts.push(`Voice: ${voice}`);

  const tagline = str(brand.tagline) ?? str(get(orgData, "step3.tagline"));
  if (tagline) brandParts.push(`Tagline: "${tagline}"`);

  if (brandParts.length > 0) sections.push(`Brand: ${brandParts.join(" | ")}`);

  // ── Goals ───────────────────────────────────────────────────────────────────
  const goals = (settings.goals ?? {}) as Record<string, unknown>;
  const focusAreas = (goals.focus_areas ?? get(orgData, "step7.focusAreas") ?? []) as string[];
  const bottleneck = str(goals.biggest_bottleneck) ?? str(get(orgData, "step7.biggestBottleneck"));

  const goalParts: string[] = [];
  if (focusAreas.length > 0) goalParts.push(`Focus areas: ${focusAreas.join(", ")}`);
  if (bottleneck) goalParts.push(`Biggest bottleneck: ${bottleneck}`);
  if (goalParts.length > 0) sections.push(goalParts.join("\n"));

  // ── Knowledge profile intelligence (condensed) ──────────────────────────────
  const kp = input.knowledgeProfile;
  if (
    (kp?.status === "ready" || kp?.status === "pending_review") &&
    kp.profile &&
    Object.keys(kp.profile).length > 0
  ) {
    const kpParts: string[] = [];
    if (kp.profile.business_summary) {
      kpParts.push(String(kp.profile.business_summary));
    }
    const services = (kp.profile.services ?? []) as Array<{ name?: string }>;
    if (services.length > 0) {
      kpParts.push(`Detected services: ${services.filter((s) => s.name).map((s) => s.name).join(", ")}`);
    }
    const members = (kp.profile.team_members ?? []) as Array<{ name?: string; detected_role?: string }>;
    if (members.length > 0) {
      kpParts.push(`Team: ${members.filter((m) => m.name).map((m) => `${m.name} (${m.detected_role ?? "unknown role"})`).join(", ")}`);
    }
    const terminology = (kp.profile.terminology ?? {}) as Record<string, string>;
    const terms = Object.entries(terminology);
    if (terms.length > 0) {
      kpParts.push(`Terminology: ${terms.map(([k, v]) => `${k} = ${v}`).join("; ")}`);
    }
    if (kpParts.length > 0) {
      sections.push(`Auto-detected intelligence:\n${kpParts.join("\n")}`);
    }
  }

  // ── Connected integrations ──────────────────────────────────────────────────
  if (input.connectedIntegrations.length > 0) {
    const names = input.connectedIntegrations.map((i) => i.name);
    sections.push(`Connected integrations: ${names.join(", ")}`);
  }

  // ── Active agents ───────────────────────────────────────────────────────────
  if (input.activeAgents && input.activeAgents.length > 0) {
    sections.push(`Active AI employees: ${input.activeAgents.join(", ")}`);
  }

  return sections.join("\n\n");
}

/**
 * Fetch all data needed for business context from the database.
 * This is a convenience function for use in API routes and Inngest functions.
 */
export async function fetchBusinessContextData(
  db: { from: (table: string) => unknown } & Record<string, unknown>,
  workspaceId: string
): Promise<BusinessContextInput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = db as any;

  const [wsResult, onboardingResult, kpResult, integrationsResult, agentConfigResult] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("name, settings")
        .eq("id", workspaceId)
        .single(),
      supabase
        .from("onboarding_state")
        .select("org_data, skyler_data")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("knowledge_profiles")
        .select("profile, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("integrations")
        .select("provider, nango_connection_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "connected"),
      supabase
        .from("agent_configurations")
        .select("agent_type")
        .eq("workspace_id", workspaceId),
    ]);

  // Map connected integrations to IntegrationInfo-compatible objects
  const connectedProviders = (integrationsResult.data ?? []) as Array<{ provider: string }>;
  const { buildIntegrationManifest } = await import("@/lib/integrations-manifest");
  const connectedIntegrations = buildIntegrationManifest(
    connectedProviders.map((p) => p.provider)
  );

  const activeAgents = ((agentConfigResult.data ?? []) as Array<{ agent_type: string }>).map(
    (a) => a.agent_type
  );

  return {
    workspace: wsResult.data ?? null,
    onboarding: onboardingResult.data ?? null,
    knowledgeProfile: kpResult.data ?? null,
    connectedIntegrations,
    activeAgents,
  };
}

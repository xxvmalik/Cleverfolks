"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { IntegrationCard } from "@/components/onboarding/shared/integration-card";
import { GENERAL_INTEGRATIONS } from "@/lib/integrations-config";

// Group integrations by category, preserving the order they appear in
const CATEGORY_ORDER = [
  ...new Set(GENERAL_INTEGRATIONS.map((i) => i.category)),
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
  connectedProviders?: string[];
};

export function Step06Connect({ workspaceId, connectedProviders }: Props) {
  const router = useRouter();
  const [connected, setConnected] = useState<string[]>(connectedProviders ?? []);
  const [loading, setLoading] = useState(false);

  function handleConnected(providerId: string) {
    setConnected((prev) => prev.includes(providerId) ? prev : [...prev, providerId]);
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: GENERAL_INTEGRATIONS.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  async function handleContinue() {
    setLoading(true);
    router.push("/onboarding?step=7");
  }

  return (
    <div className="space-y-6">
      <InfoBanner
        title="Connect your tools"
        description="Connect the tools your team uses daily. CleverBrain syncs your data from these tools to create a unified knowledge base. Your AI Employees use this data to understand your business context and work smarter."
      />

      <div className="space-y-6">
        {grouped.map(({ category, items }) => (
          <div key={category}>
            <p className="text-xs font-medium text-[#8B8F97] uppercase tracking-wider mb-3">
              {category}
            </p>
            <div className="space-y-2">
              {items.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  name={integration.name}
                  description={integration.description}
                  icon={integration.icon}
                  providerId={integration.nango_id}
                  isConnected={connected.includes(integration.id)}
                  isComingSoon={integration.status === "coming_soon"}
                  workspaceId={workspaceId}
                  onConnected={() => handleConnected(integration.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {connected.length > 0 && (
        <p className="text-xs text-[#8B8F97]">
          {connected.length} tool{connected.length !== 1 ? "s" : ""} connected
        </p>
      )}

      <p className="text-xs text-[#8B8F97]">
        Connect at least one tool so CleverBrain has data to work with. You can
        always add more later from Connectors.
      </p>

      <StepNav
        step={6}
        loading={loading}
        onBack={() => router.push("/onboarding?step=5")}
        onContinue={handleContinue}
      />
    </div>
  );
}

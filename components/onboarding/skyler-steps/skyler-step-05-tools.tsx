"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";
import { IntegrationCard } from "@/components/onboarding/shared/integration-card";
import { SKYLER_INTEGRATIONS } from "@/lib/integrations-config";

const CATEGORY_ORDER = [
  { key: "Email", label: "Email", requirement: "Required" },
  { key: "CRM", label: "CRM", requirement: "Required" },
  { key: "Lead Intelligence", label: "Lead Intelligence", requirement: "Recommended" },
  { key: "Scheduling", label: "Scheduling", requirement: "Recommended" },
  { key: "Team Notifications", label: "Team Notifications", requirement: "Optional" },
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  connectedProviders: string[];
};

export function SkylerStep05Tools({ workspaceId, savedData, connectedProviders }: Props) {
  const router = useRouter();
  const [connected, setConnected] = useState<string[]>(connectedProviders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group integrations by skylerCategory
  const grouped = CATEGORY_ORDER.map((cat) => ({
    ...cat,
    integrations: SKYLER_INTEGRATIONS.filter((i) => i.skylerCategory === cat.key),
  }));

  function handleConnect(integrationId: string) {
    // In a real flow, this would open Nango OAuth.
    // For now, toggle connected state.
    setConnected((prev) =>
      prev.includes(integrationId)
        ? prev.filter((id) => id !== integrationId)
        : [...prev, integrationId]
    );
  }

  async function handleContinue() {
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 5,
      skylerData: {
        step5: { connectedTools: connected },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=6");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 5 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Connect Tools
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Give Skyler access to the tools needed to sell on your behalf.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="I'll send emails from your actual address, log everything in your CRM, and book demos directly into your calendar. Your data stays yours — I just act on it." />

      {/* Integration Groups */}
      <div className="space-y-6">
        {grouped.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-medium text-white">{group.label}</h3>
              <span
                className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                  group.requirement === "Required"
                    ? "bg-[#F2903D]/15 text-[#F2903D]"
                    : group.requirement === "Recommended"
                      ? "bg-[#3A89FF]/15 text-[#3A89FF]"
                      : "bg-[#2A2D35] text-[#8B8F97]"
                }`}
              >
                {group.requirement}
              </span>
            </div>
            <div className="space-y-2">
              {group.integrations.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  name={integration.name}
                  description={integration.description}
                  icon={integration.icon}
                  isConnected={connected.includes(integration.id)}
                  isComingSoon={integration.status === "coming_soon"}
                  onConnect={() => handleConnect(integration.id)}
                  accentColor="#F2903D"
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#8B8F97]">
        You can connect additional tools later from Settings.
      </p>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=4")}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={loading}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[#F2903D] hover:bg-[#F2903D]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Continue
        </button>
      </div>
    </div>
  );
}

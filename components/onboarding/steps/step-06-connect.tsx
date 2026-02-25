"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { CheckCircle2 } from "lucide-react";

const INTEGRATIONS = [
  { id: "hubspot",         name: "HubSpot",          category: "CRM" },
  { id: "salesforce",      name: "Salesforce",        category: "CRM" },
  { id: "gmail",           name: "Gmail",             category: "Email" },
  { id: "outlook",         name: "Outlook",           category: "Email" },
  { id: "google-calendar", name: "Google Calendar",   category: "Calendar" },
  { id: "slack",           name: "Slack",             category: "Communication" },
  { id: "teams",           name: "Microsoft Teams",   category: "Communication" },
  { id: "notion",          name: "Notion",            category: "Knowledge" },
  { id: "confluence",      name: "Confluence",        category: "Knowledge" },
  { id: "zendesk",         name: "Zendesk",           category: "Support" },
  { id: "intercom",        name: "Intercom",          category: "Support" },
  { id: "stripe",          name: "Stripe",            category: "Revenue" },
  { id: "linear",          name: "Linear",            category: "Projects" },
  { id: "apollo",          name: "Apollo.io",         category: "Sales Tools" },
  { id: "calendly",        name: "Calendly",          category: "Sales Tools" },
];

const CATEGORY_ORDER = ["CRM","Email","Calendar","Communication","Knowledge","Support","Revenue","Projects","Sales Tools"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step06Connect({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [connected, setConnected] = useState<string[]>((s.connectedIntegrations as string[]) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setConnected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    items: INTEGRATIONS.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0);

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 6,
      orgData: { step6: { connectedIntegrations: connected } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=7");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Connect Your Tools</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Select the tools you use — SKYLER will sync with them automatically.</p>
      </div>

      <div className="space-y-5">
        {grouped.map(({ cat, items }) => (
          <div key={cat}>
            <p className="text-xs font-medium text-[#8B8F97] uppercase tracking-wider mb-2">{cat}</p>
            <div className="grid grid-cols-3 gap-3">
              {items.map(({ id, name }) => {
                const isConnected = connected.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    className={`relative flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      isConnected
                        ? "bg-[#3A89FF]/10 border-[#3A89FF] text-white"
                        : "bg-[#1C1F24] border-[#2A2D35] text-[#8B8F97] hover:border-[#3A89FF]/50 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-medium">{name}</span>
                    {isConnected && (
                      <CheckCircle2 className="w-4 h-4 text-[#3A89FF] ml-auto shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {connected.length > 0 && (
        <p className="text-xs text-[#8B8F97]">{connected.length} tool{connected.length !== 1 ? "s" : ""} selected</p>
      )}

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={6} loading={loading} onBack={() => router.push("/onboarding?step=5")} onContinue={handleContinue} />
    </div>
  );
}

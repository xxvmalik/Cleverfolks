"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { CheckCircle2, Link } from "lucide-react";

const SALES_INTEGRATIONS = [
  { id: "apollo",      name: "Apollo.io",   desc: "Prospecting & lead data" },
  { id: "calendly",   name: "Calendly",    desc: "Meeting scheduling" },
  { id: "hubspot",    name: "HubSpot",     desc: "CRM & pipeline" },
  { id: "salesforce", name: "Salesforce",  desc: "CRM & pipeline" },
  { id: "google-mail", name: "Gmail",      desc: "Email sending" },
  { id: "outlook",    name: "Outlook",     desc: "Email sending" },
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  orgData?: Record<string, unknown>;
};

export function Step12SalesTools({ workspaceId, savedData, orgData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};

  // Pre-select tools already connected in step 6
  const step6Connected = ((orgData?.step6 as Record<string, unknown>)?.connectedIntegrations as string[]) ?? [];
  const [enabled, setEnabled] = useState<string[]>(
    (s.enabledSalesTools as string[]) ?? step6Connected.filter(id => SALES_INTEGRATIONS.some(t => t.id === id))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setEnabled(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 12,
      skylerData: { step12: { enabledSalesTools: enabled } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=13");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">SKYLER&apos;s Sales Tools</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Choose which tools SKYLER can actively use when running outreach.</p>
      </div>

      <div className="space-y-3">
        {SALES_INTEGRATIONS.map(({ id, name, desc }) => {
          const isEnabled = enabled.includes(id);
          const wasConnected = step6Connected.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border text-left transition-all ${
                isEnabled
                  ? "bg-[#7C3AED]/10 border-[#7C3AED] text-white"
                  : "bg-[#1C1F24] border-[#2A2D35] text-[#8B8F97] hover:border-[#7C3AED]/40 hover:text-white"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{name}</span>
                  {wasConnected && (
                    <span className="flex items-center gap-1 text-[10px] text-[#4ADE80] bg-[#4ADE80]/10 px-1.5 py-0.5 rounded-full">
                      <Link className="w-2.5 h-2.5" /> Connected
                    </span>
                  )}
                </div>
                <span className="text-xs text-[#8B8F97]">{desc}</span>
              </div>
              {isEnabled && <CheckCircle2 className="w-5 h-5 text-[#7C3AED] shrink-0" />}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[#8B8F97]">
        You can adjust these permissions at any time from Settings → Integrations.
      </p>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={12} loading={loading} onBack={() => router.push("/onboarding?step=11")} onContinue={handleContinue} />
    </div>
  );
}

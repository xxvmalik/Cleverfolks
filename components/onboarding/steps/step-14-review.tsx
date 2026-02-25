"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepNav } from "@/components/onboarding/step-nav";
import { completeOnboardingAction } from "@/app/actions/onboarding";
import { Pencil, CheckCircle2 } from "lucide-react";

type Props = {
  workspaceId: string;
  workspaceName: string;
  orgData?: Record<string, unknown>;
  skylerData?: Record<string, unknown>;
};

function Section({ title, step, items }: { title: string; step: number; items: [string, string | undefined][] }) {
  const router = useRouter();
  const filled = items.filter(([, v]) => v?.trim());
  if (filled.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button
          type="button"
          onClick={() => router.push(`/onboarding?step=${step}`)}
          className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
      <div className="space-y-1">
        {filled.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="text-xs text-[#8B8F97] shrink-0 w-36">{label}</span>
            <span className="text-xs text-white truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Step14Review({ workspaceId, workspaceName, orgData, skylerData }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step1 = (orgData?.step1 as Record<string, string>) ?? {};
  const step2 = (orgData?.step2 as Record<string, string>) ?? {};
  const step3 = (orgData?.step3 as Record<string, string>) ?? {};
  const step4 = (orgData?.step4 as Record<string, unknown>) ?? {};
  const step5 = (orgData?.step5 as Record<string, unknown>) ?? {};
  const step6 = (orgData?.step6 as Record<string, unknown>) ?? {};
  const step7 = (orgData?.step7 as Record<string, unknown>) ?? {};
  const step8 = (skylerData?.step8 as Record<string, string>) ?? {};
  const step9 = (skylerData?.step9 as Record<string, unknown>) ?? {};
  const step11 = (skylerData?.step11 as Record<string, unknown>) ?? {};
  const step13 = (skylerData?.step13 as Record<string, unknown>) ?? {};

  const products = (step4.products as Array<{ name: string }>) ?? [];
  const invites = (step5.invites as Array<{ email: string; role: string }>) ?? [];
  const connected = (step6.connectedIntegrations as string[]) ?? [];
  const goals = (step7.goals as string[]) ?? [];
  const stages = (step9.salesStages as string[]) ?? [];
  const enabledTools = ((skylerData?.step12 as Record<string, unknown>)?.enabledSalesTools as string[]) ?? [];
  const formalityNum = step11.formality as number;
  const formalityLabel = formalityNum ? ["","Very casual","Casual","Balanced","Professional","Very formal"][formalityNum] : "";

  async function handleLaunch() {
    setLoading(true); setError(null);
    const result = await completeOnboardingAction(workspaceId);
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=done");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Review & Launch</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Everything looks good? Launch SKYLER for <span className="text-white font-medium">{workspaceName}</span>.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5 divide-y divide-[#2A2D35]">
        <div className="pb-5">
          <Section
            title="Company"
            step={1}
            items={[
              ["Name", step1.companyName],
              ["Website", step1.companyWebsite],
              ["Industry", step1.industry],
              ["Stage", step1.companyStage],
              ["Team size", step1.teamSize],
            ]}
          />
        </div>

        <div className="py-5">
          <Section
            title="Market"
            step={2}
            items={[
              ["Customer type", step2.customerType],
              ["Positioning", step2.positioning],
            ]}
          />
        </div>

        <div className="py-5">
          <Section
            title="Brand"
            step={3}
            items={[
              ["Primary colour", step3.primaryColor],
              ["Brand font", step3.brandFont],
              ["Brand voice", step3.brandVoice],
              ["Tagline", step3.tagline],
            ]}
          />
        </div>

        {products.length > 0 && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Products & Services</h3>
              <button
                type="button"
                onClick={() => router.push("/onboarding?step=4")}
                className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {products.map((p, i) => (
              <div key={i} className="text-xs text-white">{p.name}</div>
            ))}
          </div>
        )}

        {(invites.length > 0 || !!step5.yourRole) && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Team</h3>
              <button
                type="button"
                onClick={() => router.push("/onboarding?step=5")}
                className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {!!step5.yourRole && <div className="text-xs text-[#8B8F97]">Your role: <span className="text-white">{step5.yourRole as string}</span></div>}
            {invites.map((inv, i) => (
              <div key={i} className="text-xs text-white">{inv.email} <span className="text-[#8B8F97]">({inv.role})</span></div>
            ))}
          </div>
        )}

        {connected.length > 0 && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Integrations</h3>
              <button type="button" onClick={() => router.push("/onboarding?step=6")} className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {connected.map(id => (
                <span key={id} className="text-xs bg-[#131619] border border-[#2A2D35] rounded-full px-2 py-0.5 text-white">{id}</span>
              ))}
            </div>
          </div>
        )}

        {goals.length > 0 && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Goals</h3>
              <button type="button" onClick={() => router.push("/onboarding?step=7")} className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {goals.map(g => (
              <div key={g} className="flex items-center gap-2 text-xs text-white">
                <CheckCircle2 className="w-3 h-3 text-[#4ADE80] shrink-0" /> {g}
              </div>
            ))}
          </div>
        )}

        <div className="py-5">
          <Section
            title="Business Overview (SKYLER)"
            step={8}
            items={[
              ["Overview", step8.companyOverview ? step8.companyOverview.slice(0, 80) + (step8.companyOverview.length > 80 ? "…" : "") : undefined],
              ["ICP", step8.idealCustomerProfile ? step8.idealCustomerProfile.slice(0, 80) + (step8.idealCustomerProfile.length > 80 ? "…" : "") : undefined],
            ]}
          />
        </div>

        {stages.length > 0 && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Pipeline Stages</h3>
              <button type="button" onClick={() => router.push("/onboarding?step=9")} className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {stages.map((st, i) => (
                <span key={i} className="text-xs text-white">
                  {st}{i < stages.length - 1 && <span className="text-[#2A2D35] ml-2">→</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {formalityLabel && (
          <div className="py-5">
            <Section
              title="Tone & Voice"
              step={11}
              items={[["Formality", formalityLabel]]}
            />
          </div>
        )}

        {enabledTools.length > 0 && (
          <div className="py-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">SKYLER&apos;s Sales Tools</h3>
              <button type="button" onClick={() => router.push("/onboarding?step=12")} className="flex items-center gap-1 text-xs text-[#3A89FF] hover:text-[#60A5FA] transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {enabledTools.map(id => (
                <span key={id} className="text-xs bg-[#7C3AED]/10 border border-[#7C3AED]/30 rounded-full px-2 py-0.5 text-[#7C3AED]">{id}</span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-5">
          <Section
            title="Guardrails"
            step={13}
            items={[
              ["Autonomy", step13.autonomy as string],
              ["Daily limit", step13.dailyLimit as string],
            ]}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav
        step={14}
        loading={loading}
        onBack={() => router.push("/onboarding?step=13")}
        onContinue={handleLaunch}
        continueLabel="Launch SKYLER"
      />
    </div>
  );
}

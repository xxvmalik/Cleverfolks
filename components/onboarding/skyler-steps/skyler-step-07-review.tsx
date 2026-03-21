"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Rocket } from "lucide-react";
import { saveOnboardingStepAction, completeSkylerOnboardingAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";

type Props = {
  workspaceId: string;
  workspaceName: string;
  skylerData: Record<string, unknown>;
  connectedProviders: string[];
};

function SummaryCard({
  title,
  editStep,
  children,
}: {
  title: string;
  editStep: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="p-4 bg-[#1C1F24] border border-[#2A2D35] rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[10px] font-semibold text-[#8B8F97] uppercase tracking-wider">
          {title}
        </h4>
        <button
          type="button"
          onClick={() => router.push(`/onboarding/skyler?step=${editStep}`)}
          className="flex items-center gap-1 text-xs text-[#F2903D] hover:text-[#F2903D]/80 transition-colors"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[#8B8F97]">{label}: </span>
      <span className="text-white">{value}</span>
    </div>
  );
}

export function SkylerStep07Review({ workspaceId, workspaceName, skylerData, connectedProviders }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s1 = (skylerData.step1 ?? {}) as Record<string, unknown>;
  const s2 = (skylerData.step2 ?? {}) as Record<string, unknown>;
  const s3 = (skylerData.step3 ?? {}) as Record<string, unknown>;
  const s4 = (skylerData.step4 ?? {}) as Record<string, unknown>;
  const s5 = (skylerData.step5 ?? {}) as Record<string, unknown>;
  const s6 = (skylerData.step6 ?? {}) as Record<string, unknown>;

  const objections = (s3.objections ?? []) as Array<{ objection: string; response: string }>;
  const filledObjections = objections.filter((o) => o.objection.trim());
  const tools = (s5.connectedTools as string[]) ?? connectedProviders;

  // Build autonomy summary
  const autonomySummary: string[] = [];
  if (s6.autoSendFollowups) autonomySummary.push("Auto follow-ups");
  if (s6.autoHandleObjections) autonomySummary.push("Auto objection handling");
  if (s6.autoBookDemos) autonomySummary.push("Auto demo booking");
  if (s6.autoSendFirstOutreach) autonomySummary.push("Auto first outreach");
  if (autonomySummary.length === 0) autonomySummary.push("All actions require approval");

  async function handleLaunch() {
    setLoading(true);
    setError(null);

    // Save step 7 marker
    const saveResult = await saveOnboardingStepAction({
      workspaceId,
      step: 7,
      skylerData: { step7: { reviewed: true } },
    });
    if (saveResult.error) {
      setError(saveResult.error);
      setLoading(false);
      return;
    }

    // Build shared field updates for workspace settings
    const sharedFieldUpdates: Record<string, unknown> = {};
    if (s1.companyDescription) sharedFieldUpdates.company_description = s1.companyDescription;
    if (s1.idealCustomer) sharedFieldUpdates.target_audience = s1.idealCustomer;

    // Complete skyler onboarding
    const allData = { ...skylerData, step7: { reviewed: true } };
    const result = await completeSkylerOnboardingAction(workspaceId, allData, sharedFieldUpdates);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push("/onboarding/skyler?step=done");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 7 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Review &amp; Launch
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Review everything before activating Skyler for {workspaceName}.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="Here's everything I've learned. Review it carefully — once you launch me, I'll start working immediately based on these settings. You can always fine-tune later." />

      {/* Summary Cards */}
      <div className="space-y-4">
        {/* Business Context */}
        <SummaryCard title="Business Context" editStep={1}>
          <KV label="Company" value={s1.companyDescription as string} />
          <KV label="Ideal Customer" value={s1.idealCustomer as string} />
          <KV label="Core Pain" value={s1.primaryPain as string} />
          <KV label="Key Outcome" value={s1.primaryOutcome as string} />
        </SummaryCard>

        {/* Sales Process */}
        <SummaryCard title="Sales Process" editStep={2}>
          <KV label="Sales Journey" value={s2.salesJourney as string} />
          <KV label="Cycle" value={s2.cycleLength as string} />
          <KV label="Deal Size" value={s2.averageDealSize as string} />
          <KV label="Outreach Goal" value={s2.outreachGoal as string} />
        </SummaryCard>

        {/* Objections & Competitors */}
        <SummaryCard title="Objections & Competitors" editStep={3}>
          <KV
            label="Objections"
            value={
              filledObjections.length > 0
                ? `${filledObjections.length} configured`
                : "None configured"
            }
          />
          <KV label="Competitor Advantages" value={s3.competitorAdvantages as string} />
        </SummaryCard>

        {/* Tone & Voice */}
        <SummaryCard title="Tone & Voice" editStep={4}>
          <KV label="Formality" value={s4.formalityLevel as string} />
          <KV label="Approach" value={s4.communicationApproach as string} />
        </SummaryCard>

        {/* Connected Tools */}
        <SummaryCard title="Connected Tools" editStep={5}>
          {tools.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tools.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-[#F2903D]/10 text-[#F2903D] border border-[#F2903D]/20 px-2.5 py-1 rounded-full"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[#8B8F97]">No tools connected yet</span>
          )}
        </SummaryCard>

        {/* Guardrails */}
        <SummaryCard title="Guardrails" editStep={6}>
          <KV label="Autonomy" value={autonomySummary.join(", ")} />
          <KV
            label="Contact Hours"
            value={
              s6.contactHoursStart && s6.contactHoursEnd
                ? `${s6.contactHoursStart} - ${s6.contactHoursEnd}`
                : "08:00 - 18:00"
            }
          />
        </SummaryCard>
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=6")}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={loading}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[#F2903D] hover:bg-[#F2903D]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Rocket className="w-4 h-4" />
          )}
          Launch Skyler
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";
import { SelectableChips } from "@/components/onboarding/shared/selectable-chips";

const CYCLE_OPTIONS = [
  "Same day",
  "1-3 days",
  "1-2 weeks",
  "2-4 weeks",
  "1-3 months",
  "3+ months",
];

const DEAL_SIZE_OPTIONS = [
  "Under £500",
  "£500-£2K",
  "£2K-£10K",
  "£10K-£50K",
  "£50K+",
];

const OUTREACH_GOAL_OPTIONS = [
  "Book a discovery call",
  "Book a product demo",
  "Start a free trial",
  "Direct purchase",
  "Schedule a site visit",
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
};

export function SkylerStep02SalesProcess({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};

  const [salesJourney, setSalesJourney] = useState<string>(
    (s.salesJourney as string) ?? ""
  );
  const [cycleLength, setCycleLength] = useState<string>(
    (s.cycleLength as string) ?? ""
  );
  const [pricingStructure, setPricingStructure] = useState<string>(
    (s.pricingStructure as string) ?? ""
  );
  const [averageDealSize, setAverageDealSize] = useState<string>(
    (s.averageDealSize as string) ?? ""
  );
  const [outreachGoal, setOutreachGoal] = useState<string>(
    (s.outreachGoal as string) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = salesJourney.trim() && pricingStructure.trim();

  async function handleContinue() {
    if (!canContinue) return;
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 2,
      skylerData: {
        step2: { salesJourney, cycleLength, pricingStructure, averageDealSize, outreachGoal },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=3");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 2 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Sales Process
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Teach Skyler how your deals flow from first touch to close.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="Now I need to understand how you sell. A product-led self-serve motion needs a completely different approach from a high-touch enterprise sale. Tell me exactly how your deals flow." />

      {/* Fields */}
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            What does your sales journey look like? <span className="text-[#F2903D]">*</span>
          </label>
          <textarea
            value={salesJourney}
            onChange={(e) => setSalesJourney(e.target.value)}
            placeholder="Describe the typical journey from lead to customer..."
            rows={4}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Average sales cycle length
          </label>
          <SelectableChips
            options={CYCLE_OPTIONS}
            value={cycleLength}
            onChange={(v) => setCycleLength(v as string)}
            accentColor="#F2903D"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Your pricing structure <span className="text-[#F2903D]">*</span>
          </label>
          <textarea
            value={pricingStructure}
            onChange={(e) => setPricingStructure(e.target.value)}
            placeholder="Describe your pricing model, tiers, or ranges..."
            rows={3}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Average deal size
          </label>
          <SelectableChips
            options={DEAL_SIZE_OPTIONS}
            value={averageDealSize}
            onChange={(v) => setAverageDealSize(v as string)}
            accentColor="#F2903D"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Primary goal for Skyler&apos;s outreach
          </label>
          <SelectableChips
            options={OUTREACH_GOAL_OPTIONS}
            value={outreachGoal}
            onChange={(v) => setOutreachGoal(v as string)}
            accentColor="#F2903D"
          />
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=1")}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || loading}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[#F2903D] hover:bg-[#F2903D]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Continue
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  workspaceSettings?: Record<string, unknown>;
};

export function SkylerStep01Business({ workspaceId, savedData, workspaceSettings }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const bp = (workspaceSettings?.business_profile ?? {}) as Record<string, unknown>;

  const [companyDescription, setCompanyDescription] = useState<string>(
    (s.companyDescription as string) ?? (bp.company_description as string) ?? ""
  );
  const [idealCustomer, setIdealCustomer] = useState<string>(
    (s.idealCustomer as string) ?? (bp.target_audience as string) ?? ""
  );
  const [primaryPain, setPrimaryPain] = useState<string>(
    (s.primaryPain as string) ?? ""
  );
  const [primaryOutcome, setPrimaryOutcome] = useState<string>(
    (s.primaryOutcome as string) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = companyDescription.trim() && idealCustomer.trim() && primaryPain.trim();

  async function handleContinue() {
    if (!canContinue) return;
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 1,
      skylerData: {
        step1: { companyDescription, idealCustomer, primaryPain, primaryOutcome },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=2");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 1 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Your Business
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Help Skyler understand what you do and who you serve.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="Hi! I'm Skyler. Before I start handling your sales, I need to understand your business deeply. Let's start with the fundamentals — I'll ask you 7 sets of questions and then I'll be ready to work." />

      {/* Fields */}
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            What does your company do? <span className="text-[#F2903D]">*</span>
          </label>
          <textarea
            value={companyDescription}
            onChange={(e) => setCompanyDescription(e.target.value)}
            placeholder="Describe your product or service..."
            rows={3}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Who is your ideal customer? <span className="text-[#F2903D]">*</span>
          </label>
          <textarea
            value={idealCustomer}
            onChange={(e) => setIdealCustomer(e.target.value)}
            placeholder="Describe your target audience..."
            rows={3}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            What is the #1 pain your customers have before finding you? <span className="text-[#F2903D]">*</span>
          </label>
          <textarea
            value={primaryPain}
            onChange={(e) => setPrimaryPain(e.target.value)}
            placeholder="The core problem you solve..."
            rows={3}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            What outcome do your customers get after using you?
          </label>
          <textarea
            value={primaryOutcome}
            onChange={(e) => setPrimaryOutcome(e.target.value)}
            placeholder="The transformation or result..."
            rows={3}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
          />
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-end pt-4">
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

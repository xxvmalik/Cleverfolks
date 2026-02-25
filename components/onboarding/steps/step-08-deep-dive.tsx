"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  orgData?: Record<string, unknown>;
};

export function Step08DeepDive({ workspaceId, savedData, orgData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const step1 = (orgData?.step1 as Record<string, string>) ?? {};
  const step2 = (orgData?.step2 as Record<string, string>) ?? {};

  const [form, setForm] = useState({
    companyOverview: (s.companyOverview as string) ?? step1.companyDescription ?? "",
    idealCustomerProfile: (s.idealCustomerProfile as string) ?? step2.targetAudience ?? "",
    uniqueValueProp: (s.uniqueValueProp as string) ?? "",
    successStory: (s.successStory as string) ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));
  }

  async function handleContinue() {
    if (!form.companyOverview.trim()) { setError("Company overview is required"); return; }
    if (!form.idealCustomerProfile.trim()) { setError("Ideal customer profile is required"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 8,
      skylerData: { step8: form },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=9");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Deep Dive: Your Business</h1>
        <p className="text-[#8B8F97] text-sm mt-1">SKYLER needs to deeply understand your company to represent you authentically.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="companyOverview">Company overview <span className="text-[#F87171]">*</span></Label>
          <p className="text-xs text-[#8B8F97]">Pre-filled from your earlier answers — feel free to expand.</p>
          <Textarea
            id="companyOverview"
            value={form.companyOverview}
            onChange={set("companyOverview")}
            placeholder="Describe your company, what you do, and who you serve"
            rows={4}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="idealCustomerProfile">Ideal customer profile (ICP) <span className="text-[#F87171]">*</span></Label>
          <Textarea
            id="idealCustomerProfile"
            value={form.idealCustomerProfile}
            onChange={set("idealCustomerProfile")}
            placeholder="Job titles, company size, industry, pain points — be specific"
            rows={4}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uniqueValueProp">Unique value proposition <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="uniqueValueProp"
            value={form.uniqueValueProp}
            onChange={set("uniqueValueProp")}
            placeholder="What makes you the obvious choice over alternatives?"
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="successStory">Best customer success story <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="successStory"
            value={form.successStory}
            onChange={set("successStory")}
            placeholder="A specific result you achieved for a customer (SKYLER will use this as a reference)"
            rows={3}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={8} loading={loading} onBack={() => router.push("/onboarding?step=7")} onContinue={handleContinue} />
    </div>
  );
}

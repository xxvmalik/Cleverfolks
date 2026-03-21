"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableCards } from "@/components/onboarding/shared/selectable-cards";
import { TagInput } from "@/components/onboarding/shared/tag-input";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const BUSINESS_MODEL_OPTIONS = [
  { value: "B2B", title: "B2B", description: "You sell to businesses" },
  { value: "B2C", title: "B2C", description: "You sell to consumers" },
  { value: "Both", title: "Both", description: "Mix of both" },
];

function getAudiencePlaceholder(model: string): string {
  switch (model) {
    case "B2B":
      return "e.g. Series A-C SaaS founders with 20-200 employees who struggle with outbound sales and don't have a dedicated SDR team yet.";
    case "B2C":
      return "e.g. Health-conscious millennials aged 25-40 who want convenient, affordable meal prep delivered weekly.";
    case "Both":
      return "e.g. Small business owners (B2B) and individual freelancers (B2C) who need simple invoicing and expense tracking.";
    default:
      return "Describe your ideal customer — be as specific as possible about who they are, their role, company size, and pain points.";
  }
}

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step02Market({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [businessModel, setBusinessModel] = useState((s.businessModel as string) ?? "");
  const [targetAudience, setTargetAudience] = useState((s.targetAudience as string) ?? "");
  const [competitors, setCompetitors] = useState<string[]>((s.competitors as string[]) ?? []);
  const [differentiator, setDifferentiator] = useState((s.differentiator as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!businessModel) { setError("Please select your business model"); return; }
    if (!targetAudience.trim()) { setError("Please describe your target audience"); return; }
    if (competitors.length === 0) { setError("Please add at least one competitor"); return; }
    if (!differentiator.trim()) { setError("Please describe what makes you different"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 2,
      orgData: { step2: { businessModel, targetAudience, competitors, differentiator } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=3");
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <h1 className="font-heading font-bold text-2xl text-white">Your Market</h1>

      {/* Info banner */}
      <InfoBanner
        title="Who do you serve and who do you compete with?"
        description="CleverBrain uses this to understand your market position. Your AI Employees will reference this when engaging with prospects and handling competitive questions."
      />

      {/* Form fields */}
      <div className="space-y-5">
        {/* Business Model */}
        <div className="space-y-2">
          <Label>
            Who are your customers? <span className="text-[#F87171]">*</span>
          </Label>
          <SelectableCards
            options={BUSINESS_MODEL_OPTIONS}
            value={businessModel}
            onChange={(v) => setBusinessModel(v as string)}
            columns={3}
          />
        </div>

        {/* Target Audience */}
        <div className="space-y-1.5">
          <Label htmlFor="targetAudience">
            Target Audience <span className="text-[#F87171]">*</span>
          </Label>
          <Textarea
            id="targetAudience"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder={getAudiencePlaceholder(businessModel)}
            rows={4}
          />
        </div>

        {/* Key Competitors */}
        <div className="space-y-2">
          <Label>
            Key Competitors <span className="text-[#F87171]">*</span>{" "}
            <span className="text-[#8B8F97] text-xs font-normal">Up to 5</span>
          </Label>
          <TagInput
            tags={competitors}
            onChange={setCompetitors}
            placeholder="Type a competitor name and press Enter"
            maxTags={5}
          />
          <p className="text-xs text-[#8B8F97]">
            Your AI Employees use this to avoid outreach to competitor domains, position you correctly in conversations, and handle competitive objections.
          </p>
        </div>

        {/* Differentiator */}
        <div className="space-y-1.5">
          <Label htmlFor="differentiator">
            What makes you different? <span className="text-[#F87171]">*</span>
          </Label>
          <Textarea
            id="differentiator"
            value={differentiator}
            onChange={(e) => setDifferentiator(e.target.value)}
            placeholder="Your one line positioning. What's the #1 reason someone picks you over a competitor?"
            rows={3}
          />
          <p className="text-xs text-[#8B8F97]">
            This becomes your AI Employees&apos; default value proposition in sales conversations.
          </p>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav
        step={2}
        loading={loading}
        onBack={() => router.push("/onboarding?step=1")}
        onContinue={handleContinue}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableChips } from "@/components/onboarding/shared/selectable-chips";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const COMPANY_STAGES = ["Pre-revenue", "Early Traction", "Growth", "Established"];
const TEAM_SIZES = ["1-5", "6-20", "21-50", "50+"];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step01Company({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [form, setForm] = useState({
    companyName:        (s.companyName as string)        ?? "",
    companyWebsite:     (s.companyWebsite as string)     ?? "",
    companyDescription: (s.companyDescription as string) ?? "",
    industry:           (s.industry as string)           ?? "",
    companyStage:       (s.companyStage as string)       ?? "",
    teamSize:           (s.teamSize as string)           ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));
  }

  async function handleContinue() {
    if (!form.companyName.trim()) { setError("Company name is required"); return; }
    if (!form.companyDescription.trim()) { setError("Please describe what your company does"); return; }
    if (!form.industry.trim()) { setError("Industry/Sector is required"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({ workspaceId, step: 1, orgData: { step1: form } });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=2");
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <h1 className="font-heading font-bold text-2xl text-white">Your Company</h1>

      {/* Info banner */}
      <InfoBanner
        title="Welcome to Cleverfolks!"
        description="Let's set up your workspace. This information powers CleverBrain and all your AI Employees. The more context you give, the smarter they are from day one."
      />

      {/* Form fields */}
      <div className="space-y-5">
        {/* Company Name */}
        <div className="space-y-1.5">
          <Label htmlFor="companyName">
            Company Name <span className="text-[#F87171]">*</span>
          </Label>
          <Input
            id="companyName"
            value={form.companyName}
            onChange={set("companyName")}
            placeholder="e.g. Cleverfolks"
          />
        </div>

        {/* Company Website */}
        <div className="space-y-1.5">
          <Label htmlFor="companyWebsite">Company Website</Label>
          <Input
            id="companyWebsite"
            value={form.companyWebsite}
            onChange={set("companyWebsite")}
            placeholder="e.g. https://cleverfolks.com"
          />
        </div>

        {/* What does your company do? */}
        <div className="space-y-1.5">
          <Label htmlFor="companyDescription">
            What does your company do? <span className="text-[#F87171]">*</span>
          </Label>
          <Textarea
            id="companyDescription"
            value={form.companyDescription}
            onChange={set("companyDescription")}
            placeholder="Be specific. Not 'we help businesses grow' — more like 'we build AI-powered sales assistants that automate outreach for B2B SaaS startups.'"
            rows={4}
          />
          <p className="text-xs text-[#8B8F97]">
            This becomes the foundation for how CleverBrain and all AI Employees understand your business.
          </p>
        </div>

        {/* Industry/Sector */}
        <div className="space-y-1.5">
          <Label htmlFor="industry">
            Industry / Sector <span className="text-[#F87171]">*</span>
          </Label>
          <Input
            id="industry"
            value={form.industry}
            onChange={set("industry")}
            placeholder="e.g. SaaS, E-commerce, Healthcare, Fintech"
          />
        </div>

        {/* Company Stage */}
        <div className="space-y-2">
          <Label>Company Stage</Label>
          <SelectableChips
            options={COMPANY_STAGES}
            value={form.companyStage}
            onChange={(v) => setForm((p) => ({ ...p, companyStage: v as string }))}
          />
        </div>

        {/* Team Size */}
        <div className="space-y-2">
          <Label>Team Size</Label>
          <SelectableChips
            options={TEAM_SIZES}
            value={form.teamSize}
            onChange={(v) => setForm((p) => ({ ...p, teamSize: v as string }))}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={1} loading={loading} onContinue={handleContinue} />
    </div>
  );
}

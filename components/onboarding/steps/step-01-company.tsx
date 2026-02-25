"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const INDUSTRIES = ["Technology","Healthcare","Finance","Retail","Education","Marketing","Real Estate","Legal","Consulting","Other"];
const STAGES = ["Pre-revenue","Early stage","Growth","Established"];
const TEAM_SIZES = ["Just me","2–5","6–10","11–20","21–50","51+"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

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
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));
  }

  async function handleContinue() {
    if (!form.companyName.trim()) { setError("Company name is required"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({ workspaceId, step: 1, orgData: { step1: form } });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=2");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Your Company</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Tell us about your business so Cleverfolks can personalise everything for you.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company name <span className="text-[#F87171]">*</span></Label>
            <Input id="companyName" value={form.companyName} onChange={set("companyName")} placeholder="Acme Inc." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyWebsite">Website</Label>
            <Input id="companyWebsite" value={form.companyWebsite} onChange={set("companyWebsite")} placeholder="https://acme.com" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="companyDescription">Company description</Label>
          <Textarea id="companyDescription" value={form.companyDescription} onChange={set("companyDescription")} placeholder="Describe what your company does in 2–3 sentences" rows={3} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="industry">Industry</Label>
            <Select id="industry" value={form.industry} onChange={set("industry")}>
              <option value="">Select…</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyStage">Stage</Label>
            <Select id="companyStage" value={form.companyStage} onChange={set("companyStage")}>
              <option value="">Select…</option>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="teamSize">Team size</Label>
            <Select id="teamSize" value={form.teamSize} onChange={set("teamSize")}>
              <option value="">Select…</option>
              {TEAM_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={1} loading={loading} onContinue={handleContinue} />
    </div>
  );
}

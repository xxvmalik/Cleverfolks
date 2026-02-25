"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const GOALS = [
  "Generate more qualified leads",
  "Shorten sales cycle",
  "Increase close rate",
  "Improve follow-up consistency",
  "Reduce time spent on admin",
  "Scale outreach without hiring",
  "Better pipeline visibility",
  "Improve team collaboration",
];

const HEARD_ABOUT = ["Google search","LinkedIn","Friend / colleague","Twitter / X","Newsletter","Podcast","Conference","Other"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step07Goals({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [selectedGoals, setSelectedGoals] = useState<string[]>((s.goals as string[]) ?? []);
  const [bottleneck, setBottleneck] = useState((s.bottleneck as string) ?? "");
  const [heardAbout, setHeardAbout] = useState((s.heardAbout as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleGoal(goal: string) {
    setSelectedGoals(p => p.includes(goal) ? p.filter(g => g !== goal) : [...p, goal]);
  }

  async function handleContinue() {
    if (selectedGoals.length === 0) { setError("Please select at least one goal"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 7,
      orgData: { step7: { goals: selectedGoals, bottleneck, heardAbout } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=phase1done");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Goals & Context</h1>
        <p className="text-[#8B8F97] text-sm mt-1">What do you want Cleverfolks to help you achieve?</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        <div className="space-y-3">
          <Label className="text-white text-sm font-medium">Primary goals <span className="text-[#F87171]">*</span></Label>
          <div className="grid grid-cols-2 gap-3">
            {GOALS.map(goal => (
              <label key={goal} className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={selectedGoals.includes(goal)}
                  onCheckedChange={() => toggleGoal(goal)}
                  className="mt-0.5"
                />
                <span className="text-sm text-[#8B8F97] group-hover:text-white transition-colors">{goal}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bottleneck">Biggest sales bottleneck right now <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="bottleneck"
            value={bottleneck}
            onChange={e => setBottleneck(e.target.value)}
            placeholder="e.g. Not enough time to follow up with every lead consistently"
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label>How did you hear about Cleverfolks? <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Select value={heardAbout} onChange={e => setHeardAbout(e.target.value)}>
            <option value="">Select…</option>
            {HEARD_ABOUT.map(h => <option key={h} value={h}>{h}</option>)}
          </Select>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={7} loading={loading} onBack={() => router.push("/onboarding?step=6")} onContinue={handleContinue} />
    </div>
  );
}

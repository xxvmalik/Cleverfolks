"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, Trash2, GripVertical } from "lucide-react";

const DEFAULT_STAGES = ["Lead","Contacted","Qualified","Proposal Sent","Negotiation","Closed Won"];
const CYCLE_LENGTHS = ["< 1 week","1–2 weeks","2–4 weeks","1–3 months","3–6 months","6+ months"];
const DEAL_SIZES = ["< $1k","$1k–$5k","$5k–$25k","$25k–$100k","$100k+","Variable"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step09SalesProcess({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [stages, setStages] = useState<string[]>(
    (s.salesStages as string[])?.length ? (s.salesStages as string[]) : [...DEFAULT_STAGES]
  );
  const [cycleLength, setCycleLength] = useState((s.cycleLength as string) ?? "");
  const [dealSize, setDealSize] = useState((s.dealSize as string) ?? "");
  const [outreachGoal, setOutreachGoal] = useState((s.outreachGoal as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStage(i: number, val: string) {
    setStages(p => p.map((s, idx) => idx === i ? val : s));
  }
  function addStage() {
    setStages(p => [...p, ""]);
  }
  function removeStage(i: number) {
    if (stages.length > 2) setStages(p => p.filter((_, idx) => idx !== i));
  }

  async function handleContinue() {
    const validStages = stages.filter(s => s.trim());
    if (validStages.length < 2) { setError("Please define at least 2 sales stages"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 9,
      skylerData: { step9: { salesStages: validStages, cycleLength, dealSize, outreachGoal } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=10");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Sales Process</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Define your pipeline so SKYLER knows exactly where each prospect stands.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        <div className="space-y-3">
          <Label className="text-white text-sm font-medium">Pipeline stages</Label>
          <div className="space-y-2">
            {stages.map((stage, i) => (
              <div key={i} className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-[#2A2D35] shrink-0" />
                <span className="w-6 text-xs text-[#8B8F97] text-center">{i + 1}</span>
                <Input
                  value={stage}
                  onChange={e => updateStage(i, e.target.value)}
                  placeholder={`Stage ${i + 1}`}
                />
                {stages.length > 2 && (
                  <Button variant="ghost" size="icon" type="button" onClick={() => removeStage(i)}>
                    <Trash2 className="w-4 h-4 text-[#F87171]" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Button variant="outline" type="button" onClick={addStage} className="w-full">
            <Plus className="w-4 h-4" /> Add stage
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Typical sales cycle</Label>
            <Select value={cycleLength} onChange={e => setCycleLength(e.target.value)}>
              <option value="">Select…</option>
              {CYCLE_LENGTHS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Average deal size</Label>
            <Select value={dealSize} onChange={e => setDealSize(e.target.value)}>
              <option value="">Select…</option>
              {DEAL_SIZES.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="outreachGoal">Weekly outreach goal <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <div className="flex items-center gap-2">
            <Input
              id="outreachGoal"
              type="number"
              min="1"
              value={outreachGoal}
              onChange={e => setOutreachGoal(e.target.value)}
              placeholder="e.g. 50"
              className="w-32"
            />
            <span className="text-sm text-[#8B8F97]">contacts per week</span>
          </div>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={9} loading={loading} onBack={() => router.push("/onboarding?step=8")} onContinue={handleContinue} />
    </div>
  );
}

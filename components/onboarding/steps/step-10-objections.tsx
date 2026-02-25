"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, Trash2 } from "lucide-react";

type Objection = { objection: string; response: string };
type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step10Objections({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [objections, setObjections] = useState<Objection[]>(
    (s.objections as Objection[])?.length
      ? (s.objections as Objection[])
      : [{ objection: "", response: "" }]
  );
  const [competitorAdvantages, setCompetitorAdvantages] = useState((s.competitorAdvantages as string) ?? "");
  const [neverSay, setNeverSay] = useState((s.neverSay as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateObjection(i: number, field: keyof Objection, val: string) {
    setObjections(p => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }
  function addObjection() {
    setObjections(p => [...p, { objection: "", response: "" }]);
  }
  function removeObjection(i: number) {
    if (objections.length > 1) setObjections(p => p.filter((_, idx) => idx !== i));
  }

  async function handleContinue() {
    setLoading(true); setError(null);
    const validObjections = objections.filter(o => o.objection.trim());
    const result = await saveOnboardingStepAction({
      workspaceId, step: 10,
      skylerData: { step10: { objections: validObjections, competitorAdvantages, neverSay } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=11");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Objections & Battlecard</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Train SKYLER to handle objections the way your best rep would.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5">
        <div className="space-y-3">
          <Label className="text-white text-sm font-medium">Common objections & responses</Label>
          {objections.map((obj, i) => (
            <div key={i} className="space-y-2 pb-4 border-b border-[#2A2D35] last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8B8F97]">Objection {i + 1}</span>
                {objections.length > 1 && (
                  <Button variant="ghost" size="icon" type="button" onClick={() => removeObjection(i)}>
                    <Trash2 className="w-3.5 h-3.5 text-[#F87171]" />
                  </Button>
                )}
              </div>
              <Input
                value={obj.objection}
                onChange={e => updateObjection(i, "objection", e.target.value)}
                placeholder='e.g. "Your price is too high"'
              />
              <Textarea
                value={obj.response}
                onChange={e => updateObjection(i, "response", e.target.value)}
                placeholder="How SKYLER should respond..."
                rows={2}
              />
            </div>
          ))}
          <Button variant="outline" type="button" onClick={addObjection} className="w-full">
            <Plus className="w-4 h-4" /> Add objection
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="competitorAdvantages">Where you win against competitors <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="competitorAdvantages"
            value={competitorAdvantages}
            onChange={e => setCompetitorAdvantages(e.target.value)}
            placeholder="e.g. Faster onboarding than HubSpot, cheaper than Salesforce, better support than Monday"
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="neverSay">Things SKYLER should never say <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="neverSay"
            value={neverSay}
            onChange={e => setNeverSay(e.target.value)}
            placeholder='e.g. Never mention pricing first, never say "cheap", avoid mentioning competitor X by name'
            rows={3}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={10} loading={loading} onBack={() => router.push("/onboarding?step=9")} onContinue={handleContinue} />
    </div>
  );
}

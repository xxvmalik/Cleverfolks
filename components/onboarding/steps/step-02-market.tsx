"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, X } from "lucide-react";

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step02Market({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [customerType, setCustomerType] = useState((s.customerType as string) ?? "B2B");
  const [targetAudience, setTargetAudience] = useState((s.targetAudience as string) ?? "");
  const [competitors, setCompetitors] = useState<string[]>((s.competitors as string[]) ?? [""]);
  const [positioning, setPositioning] = useState((s.positioning as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addCompetitor() {
    if (competitors.length < 5) setCompetitors([...competitors, ""]);
  }
  function setCompetitor(i: number, v: string) {
    setCompetitors(competitors.map((c, idx) => (idx === i ? v : c)));
  }
  function removeCompetitor(i: number) {
    setCompetitors(competitors.filter((_, idx) => idx !== i));
  }

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 2,
      orgData: { step2: { customerType, targetAudience, competitors: competitors.filter(Boolean), positioning } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=3");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Your Market</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Help us understand who you sell to and who you compete with.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        <div className="space-y-2">
          <Label>Customer type</Label>
          <RadioGroup value={customerType} onValueChange={setCustomerType} className="flex gap-6">
            {["B2B","B2C","Both"].map(v => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`ct-${v}`} />
                <Label htmlFor={`ct-${v}`} className="text-white cursor-pointer">{v}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="targetAudience">Target audience</Label>
          <Textarea id="targetAudience" value={targetAudience} onChange={e => setTargetAudience(e.target.value)} placeholder="Describe your ideal customer" rows={3} />
        </div>

        <div className="space-y-2">
          <Label>Top competitors <span className="text-[#8B8F97] text-xs">(up to 5)</span></Label>
          {competitors.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input value={c} onChange={e => setCompetitor(i, e.target.value)} placeholder={`Competitor ${i + 1}`} />
              {competitors.length > 1 && (
                <Button variant="ghost" size="icon" type="button" onClick={() => removeCompetitor(i)}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
          {competitors.length < 5 && (
            <Button variant="outline" size="sm" type="button" onClick={addCompetitor}>
              <Plus className="w-4 h-4" /> Add competitor
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="positioning">Positioning</Label>
          <Textarea id="positioning" value={positioning} onChange={e => setPositioning(e.target.value)} placeholder="What makes you different from competitors?" rows={3} />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={2} loading={loading} onBack={() => router.push("/onboarding?step=1")} onContinue={handleContinue} />
    </div>
  );
}

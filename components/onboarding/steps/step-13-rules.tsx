"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const ESCALATION_TRIGGERS = [
  "Prospect mentions a contract or legal question",
  "Prospect asks for a demo",
  "Deal size exceeds my average",
  "Prospect mentions a competitor by name",
  "Prospect expresses frustration or complaint",
];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step13Rules({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [autonomy, setAutonomy] = useState((s.autonomy as string) ?? "supervised");
  const [dailyLimit, setDailyLimit] = useState((s.dailyLimit as string) ?? "");
  const [contactHoursStart, setContactHoursStart] = useState((s.contactHoursStart as string) ?? "09:00");
  const [contactHoursEnd, setContactHoursEnd] = useState((s.contactHoursEnd as string) ?? "18:00");
  const [excludedDomains, setExcludedDomains] = useState((s.excludedDomains as string) ?? "");
  const [escalationTriggers, setEscalationTriggers] = useState<string[]>((s.escalationTriggers as string[]) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const HOURS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

  function toggleTrigger(t: string) {
    setEscalationTriggers(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  }

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 13,
      skylerData: {
        step13: {
          autonomy,
          dailyLimit,
          contactHours: { start: contactHoursStart, end: contactHoursEnd },
          excludedDomains: excludedDomains.split(/[\n,]+/).map(d => d.trim()).filter(Boolean),
          escalationTriggers,
        },
      },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=14");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Rules & Guardrails</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Set the boundaries for how autonomously SKYLER operates.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        <div className="space-y-3">
          <Label className="text-white text-sm font-medium">SKYLER autonomy level</Label>
          <RadioGroup value={autonomy} onValueChange={setAutonomy} className="space-y-2">
            {[
              { value: "supervised",  label: "Supervised",  desc: "Drafts messages for your review before sending" },
              { value: "semi-auto",   label: "Semi-auto",   desc: "Sends routine follow-ups, flags important replies" },
              { value: "full-auto",   label: "Full auto",   desc: "Operates independently within your guardrails" },
            ].map(({ value, label, desc }) => (
              <label key={value} className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${autonomy === value ? "bg-[#7C3AED]/10 border-[#7C3AED]" : "bg-[#131619] border-[#2A2D35] hover:border-[#7C3AED]/40"}`}>
                <RadioGroupItem value={value} id={`autonomy-${value}`} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-white">{label}</div>
                  <div className="text-xs text-[#8B8F97]">{desc}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dailyLimit">Daily send limit <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
            <Input
              id="dailyLimit"
              type="number"
              min="1"
              value={dailyLimit}
              onChange={e => setDailyLimit(e.target.value)}
              placeholder="e.g. 100"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact from</Label>
            <select
              value={contactHoursStart}
              onChange={e => setContactHoursStart(e.target.value)}
              className="flex h-10 w-full rounded-md border border-[#2A2D35] bg-[#131619] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#3A89FF]"
            >
              {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Contact until</Label>
            <select
              value={contactHoursEnd}
              onChange={e => setContactHoursEnd(e.target.value)}
              className="flex h-10 w-full rounded-md border border-[#2A2D35] bg-[#131619] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#3A89FF]"
            >
              {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="excludedDomains">Excluded domains <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="excludedDomains"
            value={excludedDomains}
            onChange={e => setExcludedDomains(e.target.value)}
            placeholder={"competitor.com\npartner-company.com\n(one per line or comma-separated)"}
            rows={3}
          />
        </div>

        <div className="space-y-3">
          <Label className="text-white text-sm font-medium">Escalate to me when… <span className="text-[#8B8F97] text-xs font-normal">(optional)</span></Label>
          <div className="space-y-2">
            {ESCALATION_TRIGGERS.map(t => (
              <label key={t} className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={escalationTriggers.includes(t)}
                  onCheckedChange={() => toggleTrigger(t)}
                  className="mt-0.5"
                />
                <span className="text-sm text-[#8B8F97] group-hover:text-white transition-colors">{t}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={13} loading={loading} onBack={() => router.push("/onboarding?step=12")} onContinue={handleContinue} />
    </div>
  );
}

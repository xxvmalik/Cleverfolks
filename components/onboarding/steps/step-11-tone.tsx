"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Upload } from "lucide-react";

const FORMALITY_LABELS = ["Very casual","Casual","Balanced","Professional","Very formal"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step11Tone({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [formality, setFormality] = useState<number>((s.formality as number) ?? 3);
  const [phrasesToUse, setPhrasesToUse] = useState((s.phrasesToUse as string) ?? "");
  const [phrasesToAvoid, setPhrasesToAvoid] = useState((s.phrasesToAvoid as string) ?? "");
  const [emailSignature, setEmailSignature] = useState((s.emailSignature as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 11,
      skylerData: { step11: { formality, phrasesToUse, phrasesToAvoid, emailSignature } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=12");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">SKYLER Setup</span>
        </div>
        <h1 className="font-heading font-bold text-2xl text-white">Tone & Voice</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Fine-tune how SKYLER communicates on your behalf.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Communication formality</Label>
            <span className="text-sm text-[#3A89FF] font-medium">{FORMALITY_LABELS[formality - 1]}</span>
          </div>
          <Slider
            min={1}
            max={5}
            step={1}
            value={[formality]}
            onValueChange={([v]) => setFormality(v)}
          />
          <div className="flex justify-between text-xs text-[#8B8F97]">
            <span>Casual</span>
            <span>Formal</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Upload past email samples <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <label className="flex flex-col items-center justify-center gap-2 h-24 border-2 border-dashed border-[#2A2D35] rounded-xl cursor-pointer hover:border-[#7C3AED]/50 transition-colors">
            <Upload className="w-5 h-5 text-[#8B8F97]" />
            <span className="text-xs text-[#8B8F97]">Drop .txt or .eml files here</span>
            <span className="text-xs text-[#7C3AED]">Click to upload</span>
            <input type="file" accept=".txt,.eml,.pdf" multiple className="hidden" />
          </label>
          <p className="text-xs text-[#8B8F97]">SKYLER will analyse your writing style from these samples.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="phrasesToUse">Phrases to use <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
            <Textarea
              id="phrasesToUse"
              value={phrasesToUse}
              onChange={e => setPhrasesToUse(e.target.value)}
              placeholder={`e.g.\n"Happy to help"\n"Let's connect"\n"Quick question"`}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phrasesToAvoid">Phrases to avoid <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
            <Textarea
              id="phrasesToAvoid"
              value={phrasesToAvoid}
              onChange={e => setPhrasesToAvoid(e.target.value)}
              placeholder={`e.g.\n"Synergy"\n"Reaching out"\n"Per my last email"`}
              rows={4}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emailSignature">Email signature template <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Textarea
            id="emailSignature"
            value={emailSignature}
            onChange={e => setEmailSignature(e.target.value)}
            placeholder={"e.g.\nBest,\n[Name]\nHead of Sales | Acme Inc.\n+1 555 000 0000"}
            rows={4}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={11} loading={loading} onBack={() => router.push("/onboarding?step=10")} onContinue={handleContinue} />
    </div>
  );
}

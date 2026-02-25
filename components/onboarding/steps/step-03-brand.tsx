"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Upload } from "lucide-react";

const FONTS = ["Inter","DM Sans","Roboto","Open Sans","Lato","Montserrat","Poppins","Nunito","Raleway","Source Sans Pro"];
const VOICES = ["Professional","Friendly","Casual","Technical","Authoritative"];

type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step03Brand({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [form, setForm] = useState({
    primaryColor:   (s.primaryColor as string)   ?? "#3A89FF",
    secondaryColor: (s.secondaryColor as string)  ?? "#7C3AED",
    brandFont:      (s.brandFont as string)       ?? "Inter",
    brandVoice:     (s.brandVoice as string)      ?? "",
    tagline:        (s.tagline as string)         ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));
  }

  async function handleContinue() {
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({ workspaceId, step: 3, orgData: { step3: form } });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=4");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Your Brand</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Upload your logo and define your visual identity.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-6">
        {/* Logo uploads */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Primary logo", desc: "Light/default version" },
            { label: "Dark logo", desc: "Optional — for dark backgrounds" },
          ].map(({ label, desc }) => (
            <div key={label} className="space-y-1.5">
              <Label>{label}</Label>
              <label className="flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed border-[#2A2D35] rounded-xl cursor-pointer hover:border-[#3A89FF] transition-colors">
                <Upload className="w-5 h-5 text-[#8B8F97]" />
                <span className="text-xs text-[#8B8F97]">{desc}</span>
                <span className="text-xs text-[#3A89FF]">Click to upload</span>
                <input type="file" accept="image/*" className="hidden" />
              </label>
            </div>
          ))}
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Primary brand color</Label>
            <div className="flex items-center gap-3 h-10 px-3 rounded-md border border-[#2A2D35] bg-[#131619]">
              <input type="color" value={form.primaryColor} onChange={set("primaryColor")} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
              <span className="text-sm text-white font-mono">{form.primaryColor}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Secondary brand color</Label>
            <div className="flex items-center gap-3 h-10 px-3 rounded-md border border-[#2A2D35] bg-[#131619]">
              <input type="color" value={form.secondaryColor} onChange={set("secondaryColor")} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
              <span className="text-sm text-white font-mono">{form.secondaryColor}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Brand font</Label>
            <Select value={form.brandFont} onChange={set("brandFont")}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Brand voice</Label>
            <Select value={form.brandVoice} onChange={set("brandVoice")}>
              <option value="">Select…</option>
              {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tagline">Tagline <span className="text-[#8B8F97] text-xs">(optional)</span></Label>
          <Input id="tagline" value={form.tagline} onChange={set("tagline")} placeholder="Your company tagline" />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={3} loading={loading} onBack={() => router.push("/onboarding?step=2")} onContinue={handleContinue} />
    </div>
  );
}

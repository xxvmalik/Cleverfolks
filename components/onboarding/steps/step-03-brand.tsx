"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableCards } from "@/components/onboarding/shared/selectable-cards";
import { FileUploadZone } from "@/components/onboarding/shared/file-upload-zone";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";

const BRAND_VOICE_OPTIONS = [
  {
    value: "professional",
    title: "Professional & Polished",
    description: "Corporate, trustworthy, authoritative",
  },
  {
    value: "friendly",
    title: "Friendly & Approachable",
    description: "Warm, conversational, relatable",
  },
  {
    value: "bold",
    title: "Bold & Confident",
    description: "Direct, assertive, no-nonsense",
  },
  {
    value: "innovative",
    title: "Innovative & Modern",
    description: "Forward thinking, tech-savvy, fresh",
  },
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step03Brand({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [form, setForm] = useState({
    primaryColor:   (s.primaryColor as string)   ?? "#4A6CF7",
    secondaryColor: (s.secondaryColor as string) ?? "#1A1A2E",
    accentColor:    (s.accentColor as string)    ?? "#10B981",
    headingFont:    (s.headingFont as string)    ?? "",
    bodyFont:       (s.bodyFont as string)       ?? "",
    brandVoice:     (s.brandVoice as string)     ?? "",
    tagline:        (s.tagline as string)        ?? "",
  });
  const [primaryLogo, setPrimaryLogo] = useState<File[]>([]);
  const [darkLogo, setDarkLogo] = useState<File[]>([]);
  const [guidelineFiles, setGuidelineFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));
  }

  async function uploadFile(file: File, assetType: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("workspaceId", workspaceId);
    fd.append("assetType", assetType);
    fd.append("file", file);
    try {
      const res = await fetch("/api/brand-assets/upload", { method: "POST", body: fd });
      if (!res.ok) return null;
      const data = await res.json();
      return data.id ?? null;
    } catch {
      return null;
    }
  }

  async function handleContinue() {
    if (!form.brandVoice) { setError("Please select a brand voice"); return; }
    setLoading(true); setError(null);

    // Upload files to Supabase Storage
    const uploadPromises: Promise<string | null>[] = [];
    if (primaryLogo.length > 0) uploadPromises.push(uploadFile(primaryLogo[0], "logo_primary"));
    if (darkLogo.length > 0) uploadPromises.push(uploadFile(darkLogo[0], "logo_dark"));
    for (const gf of guidelineFiles) uploadPromises.push(uploadFile(gf, "brand_doc"));

    const uploadResults = await Promise.all(uploadPromises);
    const uploadedIds = uploadResults.filter(Boolean) as string[];

    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 3,
      orgData: {
        step3: {
          ...form,
          hasLogo: primaryLogo.length > 0,
          hasDarkLogo: darkLogo.length > 0,
          guidelineFileCount: guidelineFiles.length,
          uploadedAssetIds: uploadedIds,
        },
      },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=4");
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <h1 className="font-heading font-bold text-2xl text-white">Your Brand</h1>

      {/* Info banner */}
      <InfoBanner
        title="Your brand identity"
        description="Your AI Employees use your branding in proposals, outreach materials, documents, reports, and presentations. The more you provide, the more professional everything looks."
      />

      {/* Form fields */}
      <div className="space-y-6">
        {/* Logo uploads — side by side */}
        <div className="space-y-2">
          <Label>Company Logo</Label>
          <div className="grid grid-cols-2 gap-4">
            <FileUploadZone
              label="Primary Logo"
              description="PNG or SVG, light/default version"
              accept="image/png,image/svg+xml"
              files={primaryLogo}
              onFilesChange={setPrimaryLogo}
            />
            <FileUploadZone
              label="Dark Version"
              description="Optional — for dark backgrounds"
              accept="image/png,image/svg+xml"
              files={darkLogo}
              onFilesChange={setDarkLogo}
            />
          </div>
        </div>

        {/* Brand Colors — 3 hex inputs in a row */}
        <div className="space-y-2">
          <Label>Brand Colors</Label>
          <div className="grid grid-cols-3 gap-4">
            {([
              { key: "primaryColor" as const, label: "Primary" },
              { key: "secondaryColor" as const, label: "Secondary" },
              { key: "accentColor" as const, label: "Accent" },
            ]).map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <span className="text-xs text-[#8B8F97]">{label}</span>
                <div className="flex items-center gap-3 h-10 px-3 rounded-lg border border-[#2A2D35] bg-[#131619]">
                  <input
                    type="color"
                    value={form[key]}
                    onChange={set(key)}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={form[key]}
                    onChange={set(key)}
                    className="flex-1 bg-transparent text-sm text-white font-mono border-0 outline-none"
                    placeholder="#000000"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Brand Fonts — 2 text inputs */}
        <div className="space-y-2">
          <Label>Brand Fonts</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="text-xs text-[#8B8F97]">Heading Font</span>
              <Input
                value={form.headingFont}
                onChange={set("headingFont")}
                placeholder="e.g. Inter, Montserrat"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs text-[#8B8F97]">Body Font</span>
              <Input
                value={form.bodyFont}
                onChange={set("bodyFont")}
                placeholder="e.g. DM Sans, Open Sans"
              />
            </div>
          </div>
        </div>

        {/* Brand Guidelines file upload */}
        <div className="space-y-2">
          <Label>Brand Guidelines &amp; Documents</Label>
          <FileUploadZone
            label="Upload brand guidelines"
            description="PDF, DOCX, or images — anything that defines your visual identity"
            accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.svg"
            multiple
            files={guidelineFiles}
            onFilesChange={setGuidelineFiles}
          />
        </div>

        {/* Brand Voice — 2x2 selectable cards */}
        <div className="space-y-2">
          <Label>
            Brand Voice <span className="text-[#F87171]">*</span>
          </Label>
          <SelectableCards
            options={BRAND_VOICE_OPTIONS}
            value={form.brandVoice}
            onChange={(v) => setForm((p) => ({ ...p, brandVoice: v as string }))}
            columns={2}
          />
        </div>

        {/* Tagline */}
        <div className="space-y-1.5">
          <Label htmlFor="tagline">
            Tagline or Slogan{" "}
            <span className="text-[#8B8F97] text-xs font-normal">(optional)</span>
          </Label>
          <Input
            id="tagline"
            value={form.tagline}
            onChange={set("tagline")}
            placeholder="e.g. 'AI ideas worth millions'"
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav
        step={3}
        loading={loading}
        onBack={() => router.push("/onboarding?step=2")}
        onContinue={handleContinue}
      />
    </div>
  );
}

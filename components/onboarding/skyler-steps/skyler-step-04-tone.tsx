"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";
import { SelectableChips } from "@/components/onboarding/shared/selectable-chips";
import { TagInput } from "@/components/onboarding/shared/tag-input";

const FORMALITY_LEVELS = ["Casual", "Conversational", "Professional", "Formal"];
const COMMUNICATION_APPROACHES = [
  "Consultative",
  "Direct",
  "Story-driven",
  "Data-led",
  "Relationship-first",
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
};

export function SkylerStep04Tone({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};

  const [formalityLevel, setFormalityLevel] = useState<string>(
    (s.formalityLevel as string) ?? ""
  );
  const [communicationApproach, setCommunicationApproach] = useState<string>(
    (s.communicationApproach as string) ?? ""
  );
  const [phrasesAlwaysUse, setPhrasesAlwaysUse] = useState<string[]>(
    (s.phrasesAlwaysUse as string[]) ?? []
  );
  const [phrasesNeverUse, setPhrasesNeverUse] = useState<string[]>(
    (s.phrasesNeverUse as string[]) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 4,
      skylerData: {
        step4: { formalityLevel, communicationApproach, phrasesAlwaysUse, phrasesNeverUse },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=5");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 4 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Tone &amp; Voice
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Set how Skyler communicates with your prospects.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="I'll match your communication style from day one. Set the tone and I'll learn the rest from how you actually talk to customers through your connected tools." />

      {/* Fields */}
      <div className="space-y-6">
        {/* Formality Level - 4 buttons in a row */}
        <div>
          <label className="block text-sm font-medium text-white mb-3">
            Formality level
          </label>
          <div className="grid grid-cols-4 gap-2">
            {FORMALITY_LEVELS.map((level) => {
              const isSelected = formalityLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormalityLevel(level)}
                  className={`py-3 rounded-lg text-sm font-medium transition-all border text-center ${
                    isSelected
                      ? "bg-[#F2903D]/15 border-[#F2903D] text-white"
                      : "bg-[#1C1F24] border-[#2A2D35] text-[#8B8F97] hover:border-[#3A3D45] hover:text-white"
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>

        {/* Communication Approach */}
        <div>
          <label className="block text-sm font-medium text-white mb-3">
            Communication approach
          </label>
          <SelectableChips
            options={COMMUNICATION_APPROACHES}
            value={communicationApproach}
            onChange={(v) => setCommunicationApproach(v as string)}
            accentColor="#F2903D"
          />
        </div>

        {/* Phrases to always use */}
        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Phrases to always use
          </label>
          <p className="text-xs text-[#8B8F97] mb-2">
            Key phrases, greetings, or sign-offs Skyler should consistently use.
          </p>
          <TagInput
            tags={phrasesAlwaysUse}
            onChange={setPhrasesAlwaysUse}
            placeholder="Type a phrase and press Enter"
            maxTags={10}
            accentColor="#F2903D"
          />
        </div>

        {/* Phrases to never use */}
        <div>
          <label className="block text-sm font-medium text-white mb-1.5">
            Phrases to never use
          </label>
          <p className="text-xs text-[#8B8F97] mb-2">
            Words or phrases that don&apos;t fit your brand.
          </p>
          <TagInput
            tags={phrasesNeverUse}
            onChange={setPhrasesNeverUse}
            placeholder="Type a phrase and press Enter"
            maxTags={10}
            accentColor="#F2903D"
          />
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=3")}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={loading}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[#F2903D] hover:bg-[#F2903D]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Continue
        </button>
      </div>
    </div>
  );
}

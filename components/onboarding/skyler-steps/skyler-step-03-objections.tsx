"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";

type ObjectionPair = { objection: string; response: string };

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  workspaceSettings?: Record<string, unknown>;
};

export function SkylerStep03Objections({ workspaceId, savedData, workspaceSettings }: Props) {
  const router = useRouter();
  const s = savedData ?? {};

  // Pre-fill competitors from workspace settings
  const wsCompetitors = (workspaceSettings?.competitors ?? []) as Array<{ name?: string }>;
  const competitorNames = wsCompetitors.map((c) => c.name).filter(Boolean).join(", ");

  const defaultObjections: ObjectionPair[] = [
    { objection: "It's too expensive / not in budget", response: "" },
    { objection: "", response: "" },
    { objection: "", response: "" },
  ];

  const [objections, setObjections] = useState<ObjectionPair[]>(
    (s.objections as ObjectionPair[]) ?? defaultObjections
  );
  const [competitorAdvantages, setCompetitorAdvantages] = useState<string>(
    (s.competitorAdvantages as string) ?? (competitorNames ? `Competitors: ${competitorNames}\n\nOur advantages:\n` : "")
  );
  const [neverSay, setNeverSay] = useState<string>(
    (s.neverSay as string) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateObjection(index: number, field: keyof ObjectionPair, value: string) {
    setObjections((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addObjection() {
    if (objections.length >= 6) return;
    setObjections((prev) => [...prev, { objection: "", response: "" }]);
  }

  function removeObjection(index: number) {
    if (objections.length <= 1) return;
    setObjections((prev) => prev.filter((_, i) => i !== index));
  }

  const canContinue = objections.some((o) => o.objection.trim() && o.response.trim());

  async function handleContinue() {
    if (!canContinue) return;
    setLoading(true);
    setError(null);
    const filledObjections = objections.filter((o) => o.objection.trim() || o.response.trim());
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 3,
      skylerData: {
        step3: {
          objections: filledObjections,
          competitorAdvantages,
          neverSay,
        },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=4");
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 3 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Objections &amp; Competitors
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Prepare Skyler to handle pushback like your best rep.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="Every conversation hits resistance. Tell me exactly how you handle the objections you hear most. Don't give generic answers — tell me what your best rep actually says when a prospect pushes back on price." />

      {/* Objection Pairs */}
      <div className="space-y-5">
        <label className="block text-sm font-medium text-white">
          Common objections &amp; your responses
        </label>
        {objections.map((obj, i) => (
          <div key={i} className="space-y-2 p-4 bg-[#1C1F24] border border-[#2A2D35] rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8B8F97] font-medium">
                Objection {i + 1}
              </span>
              {objections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeObjection(i)}
                  className="text-[#8B8F97] hover:text-[#F87171] transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <input
              type="text"
              value={obj.objection}
              onChange={(e) => updateObjection(i, "objection", e.target.value)}
              placeholder="What the prospect says..."
              className="w-full bg-[#131619] border border-[#2A2D35] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50"
            />
            <textarea
              value={obj.response}
              onChange={(e) => updateObjection(i, "response", e.target.value)}
              placeholder="How you respond..."
              rows={2}
              className="w-full bg-[#131619] border border-[#2A2D35] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
            />
          </div>
        ))}
        {objections.length < 6 && (
          <button
            type="button"
            onClick={addObjection}
            className="flex items-center gap-2 text-sm text-[#F2903D] hover:text-[#F2903D]/80 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add another objection
          </button>
        )}
      </div>

      {/* Competitors */}
      <div>
        <label className="block text-sm font-medium text-white mb-1.5">
          Competitors &amp; your advantages
        </label>
        <textarea
          value={competitorAdvantages}
          onChange={(e) => setCompetitorAdvantages(e.target.value)}
          placeholder="List competitors and what makes you different..."
          rows={4}
          className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50 resize-none"
        />
      </div>

      {/* Never say */}
      <div>
        <label className="block text-sm font-medium text-white mb-1.5">
          What should Skyler NEVER say about competitors?
        </label>
        <input
          type="text"
          value={neverSay}
          onChange={(e) => setNeverSay(e.target.value)}
          placeholder='e.g. "Never badmouth Competitor X directly"'
          className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#F2903D]/50"
        />
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=2")}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || loading}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-[#F2903D] hover:bg-[#F2903D]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Continue
        </button>
      </div>
    </div>
  );
}

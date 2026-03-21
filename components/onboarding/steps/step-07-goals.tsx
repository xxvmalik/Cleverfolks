"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableCards } from "@/components/onboarding/shared/selectable-cards";
import {
  saveOnboardingStepAction,
  completeGeneralOnboardingAction,
} from "@/app/actions/onboarding";
import { Sparkles } from "lucide-react";

const FOCUS_AREA_OPTIONS = [
  {
    value: "sales_automation",
    title: "Sales Automation",
    description: "Lead follow-ups, outreach, pipeline management",
  },
  {
    value: "meeting_management",
    title: "Meeting Management",
    description: "Prep, scheduling, follow-ups, notes",
  },
  {
    value: "email_management",
    title: "Email Management",
    description: "Triage, drafts, summaries, organisation",
  },
  {
    value: "data_insights",
    title: "Data and Insights",
    description: "Reports, trends, business intelligence",
  },
  {
    value: "content_creation",
    title: "Content Creation",
    description: "Marketing copy, socials, campaigns",
  },
  {
    value: "team_coordination",
    title: "Team Coordination",
    description: "Status updates, task tracking, alignment",
  },
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step07Goals({ workspaceId, savedData, allOrgData }: Props) {
  const router = useRouter();
  const s = (savedData ?? {}) as Record<string, unknown>;

  const [focusAreas, setFocusAreas] = useState<string[]>(
    (s.focusAreas as string[]) ?? []
  );
  const [bottleneck, setBottleneck] = useState<string>(
    (s.bottleneck as string) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (focusAreas.length === 0) {
      setError("Please select at least one area.");
      return;
    }
    if (!bottleneck.trim()) {
      setError("Please describe your biggest bottleneck.");
      return;
    }

    setLoading(true);
    setError(null);

    const step7Data = { focusAreas, bottleneck };

    // 1. Save step data
    const saveResult = await saveOnboardingStepAction({
      workspaceId,
      step: 7,
      orgData: { step7: step7Data },
    });

    if (saveResult.error) {
      setError(saveResult.error);
      setLoading(false);
      return;
    }

    // 2. Complete general onboarding with merged org data
    const allOrgDataMerged = { ...allOrgData, step7: step7Data };
    const completeResult = await completeGeneralOnboardingAction(
      workspaceId,
      allOrgDataMerged
    );

    if (completeResult.error) {
      setError(completeResult.error);
      setLoading(false);
      return;
    }

    // 3. Navigate to phase1done
    router.push("/onboarding?step=phase1done");
  }

  return (
    <div className="space-y-6">
      <InfoBanner
        title="Your Goals"
        description="What do you want CleverFolks to help with? This helps us personalise your dashboard and configure your AI Employees to focus on what matters most to you."
      />

      {/* Focus Areas */}
      <div className="space-y-3">
        <Label className="text-white text-sm font-medium">
          What do you want CleverFolks to help with?{" "}
          <span className="text-[#F87171]">*</span>
        </Label>
        <SelectableCards
          options={FOCUS_AREA_OPTIONS}
          value={focusAreas}
          onChange={(val) => setFocusAreas(val as string[])}
          multi={true}
          columns={2}
        />
      </div>

      {/* Bottleneck */}
      <div className="space-y-2">
        <Label htmlFor="bottleneck" className="text-white text-sm font-medium">
          What&apos;s your biggest bottleneck right now?{" "}
          <span className="text-[#F87171]">*</span>
        </Label>
        <Textarea
          id="bottleneck"
          value={bottleneck}
          onChange={(e) => setBottleneck(e.target.value)}
          placeholder="Be honest. What takes up the most time that shouldn't? What drops through the cracks? This directly shapes how your AI Employees prioritise their work."
          rows={4}
        />
      </div>

      {/* Transition Banner */}
      <div className="rounded-xl border border-[#5B3DC8]/30 bg-[#5B3DC8]/8 p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#5B3DC8]/20 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-[#5B3DC8]" />
          </div>
          <div>
            <div className="font-semibold text-white text-sm">
              Almost there — SKYLER setup is next
            </div>
            <p className="text-xs text-[#8B8F97] mt-1.5 leading-relaxed">
              Your AI Sales Assistant needs a few more details to start working.
              Once your workspace is ready, we&apos;ll walk you through setting up
              SKYLER — your AI Sales Assistant. She&apos;ll need to know about your
              sales process, messaging style, and a few rules. Takes about 5
              minutes.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      <StepNav
        step={7}
        loading={loading}
        onBack={() => router.push("/onboarding?step=6")}
        onContinue={handleComplete}
        continueLabel="Complete Setup ✓"
      />
    </div>
  );
}

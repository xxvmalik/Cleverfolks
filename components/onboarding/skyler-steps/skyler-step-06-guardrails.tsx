"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { SkylerQuote } from "@/components/onboarding/shared/skyler-quote";

const HARD_RULES = [
  'Escalate immediately when prospect says "ready to buy"',
  "Escalate if prospect mentions legal or contract issues",
  'Stop all contact if prospect says "unsubscribe" or "stop"',
  "Never quote below minimum price",
];

const CONFIDENCE_THRESHOLDS = [
  { range: "85%+", action: "Send Autonomously", color: "#4ADE80" },
  { range: "60-84%", action: "Draft + Ask You", color: "#F2903D" },
  { range: "Below 60%", action: "Flag for Human", color: "#F87171" },
];

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
};

export function SkylerStep06Guardrails({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};

  const [autoSendFollowups, setAutoSendFollowups] = useState<boolean>(
    (s.autoSendFollowups as boolean) ?? true
  );
  const [autoHandleObjections, setAutoHandleObjections] = useState<boolean>(
    (s.autoHandleObjections as boolean) ?? true
  );
  const [autoBookDemos, setAutoBookDemos] = useState<boolean>(
    (s.autoBookDemos as boolean) ?? false
  );
  const [autoSendFirstOutreach, setAutoSendFirstOutreach] = useState<boolean>(
    (s.autoSendFirstOutreach as boolean) ?? false
  );
  const [contactHoursStart, setContactHoursStart] = useState<string>(
    (s.contactHoursStart as string) ?? "08:00"
  );
  const [contactHoursEnd, setContactHoursEnd] = useState<string>(
    (s.contactHoursEnd as string) ?? "18:00"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 6,
      skylerData: {
        step6: {
          autoSendFollowups,
          autoHandleObjections,
          autoBookDemos,
          autoSendFirstOutreach,
          contactHoursStart,
          contactHoursEnd,
        },
      },
    });
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/onboarding/skyler?step=7");
  }

  const toggles = [
    {
      label: "Send follow-up emails automatically",
      description: "Skyler sends follow-ups on schedule without waiting for your approval.",
      value: autoSendFollowups,
      onChange: setAutoSendFollowups,
    },
    {
      label: "Handle objections autonomously",
      description: "Skyler responds to common objections using your trained responses.",
      value: autoHandleObjections,
      onChange: setAutoHandleObjections,
    },
    {
      label: "Book demos automatically",
      description: "Skyler books meetings directly into your calendar when prospects are ready.",
      value: autoBookDemos,
      onChange: setAutoBookDemos,
    },
    {
      label: "Send first outreach autonomously",
      description: "Skyler initiates contact with new leads without requiring your review.",
      value: autoSendFirstOutreach,
      onChange: setAutoSendFirstOutreach,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-[#F2903D] uppercase tracking-wider mb-2">
          Step 6 of 7
        </p>
        <h1 className="font-heading font-bold text-2xl text-white">
          Guardrails
        </h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Control how much autonomy Skyler has when engaging prospects.
        </p>
      </div>

      {/* Skyler Quote */}
      <SkylerQuote text="I'd rather ask for your approval than risk sending something wrong to an important prospect. Start strict — you can always give me more autonomy once you've seen how I perform." />

      {/* Autonomy Toggles */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">Autonomy Settings</h3>
        {toggles.map((toggle) => (
          <div
            key={toggle.label}
            className="flex items-center justify-between p-4 bg-[#1C1F24] border border-[#2A2D35] rounded-xl"
          >
            <div className="flex-1 mr-4">
              <div className="text-sm font-medium text-white">{toggle.label}</div>
              <div className="text-xs text-[#8B8F97] mt-0.5">{toggle.description}</div>
            </div>
            <button
              type="button"
              onClick={() => toggle.onChange(!toggle.value)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                toggle.value ? "bg-[#F2903D]" : "bg-[#2A2D35]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  toggle.value ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Hard Rules */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#F2903D]" />
          <h3 className="text-sm font-medium text-white">Hard Rules</h3>
          <span className="text-[10px] text-[#8B8F97] bg-[#2A2D35] px-2 py-0.5 rounded-full">
            Always enforced
          </span>
        </div>
        <div className="space-y-2">
          {HARD_RULES.map((rule) => (
            <div
              key={rule}
              className="flex items-center gap-3 p-3 bg-[#F2903D]/8 border border-[#F2903D]/20 rounded-lg"
            >
              <Lock className="w-4 h-4 text-[#F2903D] flex-shrink-0" />
              <span className="text-sm text-white">{rule}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence Thresholds */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">Confidence Thresholds</h3>
        <div className="space-y-2">
          {CONFIDENCE_THRESHOLDS.map((t) => (
            <div
              key={t.range}
              className="flex items-center justify-between p-3 bg-[#1C1F24] border border-[#2A2D35] rounded-lg"
            >
              <span
                className="text-sm font-medium"
                style={{ color: t.color }}
              >
                {t.range}
              </span>
              <span className="text-sm text-[#8B8F97]">{t.action}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Contact Hours */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">Contact Hours</h3>
        <p className="text-xs text-[#8B8F97]">
          Skyler will only reach out to prospects during these hours (in the prospect&apos;s timezone).
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[#8B8F97] mb-1">Start</label>
            <input
              type="time"
              value={contactHoursStart}
              onChange={(e) => setContactHoursStart(e.target.value)}
              className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F2903D]/50 [color-scheme:dark]"
            />
          </div>
          <span className="text-[#8B8F97] mt-5">to</span>
          <div className="flex-1">
            <label className="block text-xs text-[#8B8F97] mb-1">End</label>
            <input
              type="time"
              value={contactHoursEnd}
              onChange={(e) => setContactHoursEnd(e.target.value)}
              className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F2903D]/50 [color-scheme:dark]"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => router.push("/onboarding/skyler?step=5")}
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

"use client";

import { Check } from "lucide-react";
import { SkylerSuccessScreen } from "@/components/onboarding/success-skyler";
import { SkylerStep01Business } from "@/components/onboarding/skyler-steps/skyler-step-01-business";
import { SkylerStep02SalesProcess } from "@/components/onboarding/skyler-steps/skyler-step-02-sales-process";
import { SkylerStep03Objections } from "@/components/onboarding/skyler-steps/skyler-step-03-objections";
import { SkylerStep04Tone } from "@/components/onboarding/skyler-steps/skyler-step-04-tone";
import { SkylerStep05Tools } from "@/components/onboarding/skyler-steps/skyler-step-05-tools";
import { SkylerStep06Guardrails } from "@/components/onboarding/skyler-steps/skyler-step-06-guardrails";
import { SkylerStep07Review } from "@/components/onboarding/skyler-steps/skyler-step-07-review";

const TOTAL_STEPS = 7;

const STEP_LABELS: Record<number, string> = {
  1: "Your Business",
  2: "Sales Process",
  3: "Objections & Competitors",
  4: "Tone & Voice",
  5: "Connect Tools",
  6: "Guardrails",
  7: "Review & Launch",
};

type Props = {
  step: number | string;
  workspaceId: string;
  workspaceName: string;
  skylerData: Record<string, unknown>;
  workspaceSettings: Record<string, unknown>;
  connectedProviders: string[];
};

export function SkylerOnboardingShell({
  step,
  workspaceId,
  workspaceName,
  skylerData,
  workspaceSettings,
  connectedProviders,
}: Props) {
  // Success screen
  if (step === "done") {
    return (
      <div className="min-h-screen bg-[#131619] flex items-center justify-center p-4">
        <SkylerSuccessScreen />
      </div>
    );
  }

  const currentStep = typeof step === "number" ? step : 1;
  const stepKey = `step${currentStep}`;
  const savedData = skylerData[stepKey] as Record<string, unknown> | undefined;

  function renderStep() {
    const shared = { workspaceId, savedData };
    switch (currentStep) {
      case 1:
        return (
          <SkylerStep01Business
            {...shared}
            workspaceSettings={workspaceSettings}
          />
        );
      case 2:
        return <SkylerStep02SalesProcess {...shared} />;
      case 3:
        return (
          <SkylerStep03Objections
            {...shared}
            workspaceSettings={workspaceSettings}
          />
        );
      case 4:
        return <SkylerStep04Tone {...shared} />;
      case 5:
        return (
          <SkylerStep05Tools
            {...shared}
            connectedProviders={connectedProviders}
          />
        );
      case 6:
        return <SkylerStep06Guardrails {...shared} />;
      case 7:
        return (
          <SkylerStep07Review
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            skylerData={skylerData}
            connectedProviders={connectedProviders}
          />
        );
      default:
        return (
          <SkylerStep01Business
            {...shared}
            workspaceSettings={workspaceSettings}
          />
        );
    }
  }

  return (
    <div className="min-h-screen bg-[#131619] flex">
      {/* Left Sidebar */}
      <aside className="w-[280px] min-h-screen bg-[#1A1D21] border-r border-[#2A2D35] flex flex-col p-6 shrink-0">
        {/* Logo */}
        <div className="mb-8">
          <span className="font-heading font-bold text-white text-lg">
            Cleverfolks
          </span>
        </div>

        {/* Skyler Avatar + Title */}
        <div className="flex items-start gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-[#0086FF] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <div>
            <h2 className="text-white font-semibold text-sm leading-tight">
              Setting up Skyler for your business
            </h2>
          </div>
        </div>
        <p className="text-[#8B8F97] text-xs mb-8 ml-[52px]">
          Answer 7 sections to configure Skyler
        </p>

        {/* Step List */}
        <nav className="flex-1 space-y-1">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => {
            const isActive = s === currentStep;
            const isCompleted = s < currentStep;
            const isFuture = s > currentStep;

            return (
              <div
                key={s}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? "bg-[#F2903D]/10"
                    : ""
                }`}
              >
                {/* Step number / check */}
                {isCompleted ? (
                  <div className="w-7 h-7 rounded-full bg-[#4ADE80]/15 flex items-center justify-center flex-shrink-0">
                    <Check className="w-4 h-4 text-[#4ADE80]" />
                  </div>
                ) : (
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                      isActive
                        ? "bg-[#F2903D] text-white"
                        : "bg-[#2A2D35] text-[#8B8F97]"
                    }`}
                  >
                    {s}
                  </div>
                )}
                {/* Label */}
                <span
                  className={`text-sm ${
                    isActive
                      ? "text-[#F2903D] font-medium"
                      : isCompleted
                        ? "text-[#4ADE80]"
                        : isFuture
                          ? "text-[#8B8F97]/60"
                          : "text-[#8B8F97]"
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="pt-6 border-t border-[#2A2D35]">
          <p className="text-[#8B8F97] text-xs">~15 minutes to complete</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          {renderStep()}
        </div>

        {/* Bottom step counter */}
        <div className="sticky bottom-0 bg-[#131619]/90 backdrop-blur border-t border-[#2A2D35] py-3">
          <p className="text-center text-xs text-[#8B8F97]">
            {currentStep} / {TOTAL_STEPS}
          </p>
        </div>
      </main>
    </div>
  );
}

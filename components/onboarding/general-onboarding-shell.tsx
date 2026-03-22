"use client";

import { OrgSuccessScreen } from "@/components/onboarding/success-org";
import { Step01Company } from "@/components/onboarding/steps/step-01-company";
import { Step02Market } from "@/components/onboarding/steps/step-02-market";
import { Step03Brand } from "@/components/onboarding/steps/step-03-brand";
import { Step04Products } from "@/components/onboarding/steps/step-04-products";
import { Step05Team } from "@/components/onboarding/steps/step-05-team";
import { Step06Connect } from "@/components/onboarding/steps/step-06-connect";
import { Step07Goals } from "@/components/onboarding/steps/step-07-goals";

const TABS = [
  { step: 1, label: "Your Company" },
  { step: 2, label: "Your Market" },
  { step: 3, label: "Your Brand" },
  { step: 4, label: "Product and Services" },
  { step: 5, label: "Team and Work Style" },
  { step: 6, label: "Connect Tools" },
  { step: 7, label: "Your Goals" },
];

const PURPLE = "#5B3DC8";

type Props = {
  step: number | string;
  workspaceId: string;
  workspaceName: string;
  orgData: Record<string, unknown>;
  connectedProviders?: string[];
};

export function GeneralOnboardingShell({ step, workspaceId, workspaceName, orgData, connectedProviders }: Props) {
  if (step === "phase1done") {
    return (
      <div className="min-h-screen bg-[#131619] flex items-center justify-center p-4">
        <OrgSuccessScreen />
      </div>
    );
  }

  const currentStep = typeof step === "number" ? step : 1;
  const stepKey = `step${currentStep}`;
  const savedData = orgData[stepKey] as Record<string, unknown> | undefined;
  const sharedProps = { workspaceId, savedData, allOrgData: orgData };

  function renderStep() {
    switch (currentStep) {
      case 1: return <Step01Company {...sharedProps} />;
      case 2: return <Step02Market {...sharedProps} />;
      case 3: return <Step03Brand {...sharedProps} />;
      case 4: return <Step04Products {...sharedProps} />;
      case 5: return <Step05Team {...sharedProps} />;
      case 6: return <Step06Connect {...sharedProps} connectedProviders={connectedProviders} />;
      case 7: return <Step07Goals {...sharedProps} />;
      default: return <Step01Company {...sharedProps} />;
    }
  }

  return (
    <div className="min-h-screen bg-[#131619] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#5B3DC8] flex items-center justify-center">
            <span className="text-white font-bold text-xs">CF</span>
          </div>
          <span className="text-white font-bold text-lg">Cleverfolks</span>
        </div>
      </div>

      {/* Content card */}
      <div className="flex-1 flex justify-center px-4 pb-8">
        <div className="w-full max-w-4xl bg-[#1A1D21] rounded-2xl border border-[#2A2D35]/50 p-8">
          {/* Tab bar */}
          <div className="flex flex-wrap gap-2 mb-8">
            {TABS.map((tab) => {
              const isActive = tab.step === currentStep;
              return (
                <div
                  key={tab.step}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? "text-white"
                      : "border border-[#2A2D35] text-[#8B8F97]"
                  }`}
                  style={isActive ? { backgroundColor: PURPLE } : undefined}
                >
                  {tab.label}
                </div>
              );
            })}
          </div>

          {/* Step content */}
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

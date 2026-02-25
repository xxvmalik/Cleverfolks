"use client";

import { Progress } from "@/components/ui/progress";
import { OrgSuccessScreen } from "@/components/onboarding/success-org";
import { SkylerSuccessScreen } from "@/components/onboarding/success-skyler";
import { Step01Company }     from "@/components/onboarding/steps/step-01-company";
import { Step02Market }      from "@/components/onboarding/steps/step-02-market";
import { Step03Brand }       from "@/components/onboarding/steps/step-03-brand";
import { Step04Products }    from "@/components/onboarding/steps/step-04-products";
import { Step05Team }        from "@/components/onboarding/steps/step-05-team";
import { Step06Connect }     from "@/components/onboarding/steps/step-06-connect";
import { Step07Goals }       from "@/components/onboarding/steps/step-07-goals";
import { Step08DeepDive }    from "@/components/onboarding/steps/step-08-deep-dive";
import { Step09SalesProcess } from "@/components/onboarding/steps/step-09-sales-process";
import { Step10Objections }  from "@/components/onboarding/steps/step-10-objections";
import { Step11Tone }        from "@/components/onboarding/steps/step-11-tone";
import { Step12SalesTools }  from "@/components/onboarding/steps/step-12-sales-tools";
import { Step13Rules }       from "@/components/onboarding/steps/step-13-rules";
import { Step14Review }      from "@/components/onboarding/steps/step-14-review";

const TOTAL_STEPS = 14;
const PHASE1_STEPS = 7;

const STEP_LABELS: Record<number, string> = {
  1:  "Company",
  2:  "Market",
  3:  "Brand",
  4:  "Products",
  5:  "Team",
  6:  "Integrations",
  7:  "Goals",
  8:  "Business Overview",
  9:  "Sales Process",
  10: "Objections",
  11: "Tone & Voice",
  12: "Sales Tools",
  13: "Rules",
  14: "Review",
};

type Props = {
  step: number | string;
  workspaceId: string;
  workspaceName: string;
  orgData: Record<string, unknown>;
  skylerData: Record<string, unknown>;
};

export function OnboardingShell({ step, workspaceId, workspaceName, orgData, skylerData }: Props) {
  // Handle success screens
  if (step === "phase1done") {
    return (
      <div className="min-h-screen bg-[#131619] flex items-center justify-center p-4">
        <OrgSuccessScreen />
      </div>
    );
  }
  if (step === "done") {
    return (
      <div className="min-h-screen bg-[#131619] flex items-center justify-center p-4">
        <SkylerSuccessScreen />
      </div>
    );
  }

  const currentStep = typeof step === "number" ? step : 1;
  const progressPct = (currentStep / TOTAL_STEPS) * 100;
  const isPhase2 = currentStep > PHASE1_STEPS;

  // Resolve saved data for the current step
  const stepKey = `step${currentStep}` as string;
  const savedData = isPhase2
    ? (skylerData[stepKey] as Record<string, unknown> | undefined)
    : (orgData[stepKey] as Record<string, unknown> | undefined);

  const sharedProps = { workspaceId, savedData };

  function renderStep() {
    switch (currentStep) {
      case 1:  return <Step01Company {...sharedProps} />;
      case 2:  return <Step02Market  {...sharedProps} />;
      case 3:  return <Step03Brand   {...sharedProps} />;
      case 4:  return <Step04Products {...sharedProps} />;
      case 5:  return <Step05Team    {...sharedProps} />;
      case 6:  return <Step06Connect  {...sharedProps} />;
      case 7:  return <Step07Goals    {...sharedProps} />;
      case 8:  return <Step08DeepDive  {...sharedProps} orgData={orgData} />;
      case 9:  return <Step09SalesProcess {...sharedProps} />;
      case 10: return <Step10Objections   {...sharedProps} />;
      case 11: return <Step11Tone         {...sharedProps} />;
      case 12: return <Step12SalesTools   {...sharedProps} orgData={orgData} />;
      case 13: return <Step13Rules        {...sharedProps} />;
      case 14: return (
        <Step14Review
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          orgData={orgData}
          skylerData={skylerData}
        />
      );
      default: return <Step01Company {...sharedProps} />;
    }
  }

  return (
    <div className="min-h-screen bg-[#131619] flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#131619]/95 backdrop-blur border-b border-[#2A2D35]">
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-heading font-bold text-white text-lg">Cleverfolks</span>
              {isPhase2 && (
                <span className="text-xs font-semibold text-[#7C3AED] bg-[#7C3AED]/10 px-2 py-0.5 rounded-full">
                  SKYLER Setup
                </span>
              )}
            </div>
            <span className="text-xs text-[#8B8F97]">
              Step {currentStep} of {TOTAL_STEPS} — {STEP_LABELS[currentStep]}
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
      </div>

      {/* Phase header */}
      {currentStep === 1 && (
        <div className="max-w-2xl mx-auto px-6 pt-8 pb-2 w-full">
          <div className="flex items-center gap-3 text-sm text-[#8B8F97]">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#3A89FF] text-white text-xs font-bold">1</span>
            <span className="font-medium text-white">Phase 1: Workspace Setup</span>
            <span className="text-[#2A2D35]">·</span>
            <span>Steps 1–7</span>
          </div>
        </div>
      )}
      {currentStep === 8 && (
        <div className="max-w-2xl mx-auto px-6 pt-8 pb-2 w-full">
          <div className="flex items-center gap-3 text-sm text-[#8B8F97]">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#7C3AED] text-white text-xs font-bold">2</span>
            <span className="font-medium text-white">Phase 2: SKYLER Configuration</span>
            <span className="text-[#2A2D35]">·</span>
            <span>Steps 8–14</span>
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        {renderStep()}
      </div>
    </div>
  );
}

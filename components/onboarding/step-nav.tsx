"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";

type Props = {
  step: number;
  loading?: boolean;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
};

export function StepNav({
  step,
  loading = false,
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
}: Props) {
  const isLaunch = continueLabel === "Launch SKYLER";

  return (
    <div className="flex items-center justify-between pt-6">
      <div>
        {step > 1 && onBack && (
          <Button variant="ghost" onClick={onBack} type="button">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        )}
      </div>
      <Button
        onClick={onContinue}
        disabled={loading || continueDisabled}
        type="button"
        size="lg"
        className={isLaunch ? "bg-[#7C3AED] hover:bg-[#7C3AED]/90" : ""}
      >
        {loading ? "Saving…" : continueLabel}
        {!loading && (isLaunch ? <Rocket className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />)}
      </Button>
    </div>
  );
}

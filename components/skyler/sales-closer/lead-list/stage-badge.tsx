"use client";

import {
  getPhase,
  getStageLabel,
  isResolvedPositive,
  isResolvedNegative,
  STAGES,
  type Phase,
} from "@/lib/skyler/pipeline-stages";

function getPhaseColor(stage: string): string {
  const phase = getPhase(stage);
  if (phase === "prospecting") return "#0086FF";
  if (phase === "engaged") return "#F2903D";
  if (isResolvedPositive(stage)) return "#3ECF8E";
  if (isResolvedNegative(stage)) return "#E54545";
  if (stage === STAGES.STALLED) return "#C6E84B";
  return "#F2903D";
}

export function getPhaseForStage(stage: string): Phase {
  return getPhase(stage);
}

export function StageBadge({ stage }: { stage: string }) {
  const color = getPhaseColor(stage);
  const label = getStageLabel(stage);

  return (
    <span
      style={{
        background: `${color}18`,
        color: color,
        border: `1px solid ${color}30`,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

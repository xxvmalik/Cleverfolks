"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";
import { HIDDEN_ACTIVITIES } from "@/lib/skyler/chat-constants";

type ActivityStepsProps = {
  activities: string[];
  isComplete: boolean;
  /** "panel" = compact (Sales Closer right panel), "inline" = with avatar (Lead Qualification) */
  variant?: "panel" | "inline";
};

export function ActivitySteps({
  activities,
  isComplete,
  variant = "panel",
}: ActivityStepsProps) {
  const [expanded, setExpanded] = useState(true);

  // Filter out internal-only activities
  const steps = activities.filter((a) => !HIDDEN_ACTIVITIES.has(a));
  if (steps.length === 0) return null;

  const isPanel = variant === "panel";

  return (
    <div className={isPanel ? "flex justify-start" : "flex gap-3 items-start"}>
      <div
        style={{
          maxWidth: isPanel ? "88%" : "85%",
          overflowWrap: "break-word",
          wordBreak: "break-word",
          flex: isPanel ? undefined : 1,
        }}
      >
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 w-full text-left"
          style={{
            padding: isPanel ? "6px 10px" : "6px 12px",
            borderRadius: isPanel ? 10 : 8,
            background: "rgba(242,144,61,0.06)",
            border: "1px solid rgba(242,144,61,0.12)",
            fontSize: isPanel ? 10 : 11,
            fontWeight: 500,
            color: isPanel ? "var(--sk-orange, #F2903D)" : "#F2903D",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
        >
          {isComplete ? (
            <Check size={isPanel ? 11 : 12} style={{ opacity: 0.7, flexShrink: 0 }} />
          ) : (
            <Loader2 size={isPanel ? 11 : 12} className="animate-spin" style={{ flexShrink: 0 }} />
          )}
          <span>
            {isComplete
              ? `Done — ${steps.length} step${steps.length !== 1 ? "s" : ""}`
              : steps[steps.length - 1]}
          </span>
          {expanded ? (
            <ChevronDown size={isPanel ? 10 : 11} style={{ marginLeft: "auto", opacity: 0.5 }} />
          ) : (
            <ChevronRight size={isPanel ? 10 : 11} style={{ marginLeft: "auto", opacity: 0.5 }} />
          )}
        </button>

        {expanded && (
          <div
            style={{
              marginTop: 4,
              paddingLeft: 12,
              borderLeft: "2px solid rgba(242,144,61,0.15)",
              marginLeft: 8,
            }}
          >
            {steps.map((step, i) => {
              const isDone = isComplete || i < steps.length - 1;
              return (
                <div
                  key={`${step}-${i}`}
                  className="flex items-center gap-1.5"
                  style={{
                    padding: "3px 0",
                    fontSize: isPanel ? 10 : 11,
                    color: isDone
                      ? (isPanel ? "var(--sk-t3, #555A63)" : "#555A63")
                      : (isPanel ? "var(--sk-t2, #8B8F97)" : "#8B8F97"),
                  }}
                >
                  {isDone ? (
                    <Check size={isPanel ? 9 : 10} style={{ color: isPanel ? "var(--sk-green, #4ADE80)" : "#4ADE80", flexShrink: 0 }} />
                  ) : (
                    <Loader2 size={isPanel ? 9 : 10} className="animate-spin" style={{ color: "#F2903D", flexShrink: 0 }} />
                  )}
                  <span>{step}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

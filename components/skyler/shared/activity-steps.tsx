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
            padding: isPanel ? "4px 8px" : "5px 10px",
            borderRadius: isPanel ? 8 : 6,
            background: "rgba(242,144,61,0.04)",
            border: "1px solid rgba(242,144,61,0.08)",
            fontSize: isPanel ? 9 : 9,
            fontWeight: 400,
            color: isPanel ? "var(--sk-t4, rgba(255,255,255,0.18))" : "rgba(255,255,255,0.18)",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
        >
          {isComplete ? (
            <Check size={9} style={{ opacity: 0.5, flexShrink: 0 }} />
          ) : (
            <Loader2 size={9} className="animate-spin" style={{ flexShrink: 0 }} />
          )}
          <span>
            {isComplete
              ? `Done — ${steps.length} step${steps.length !== 1 ? "s" : ""}`
              : steps[steps.length - 1]}
          </span>
          {expanded ? (
            <ChevronDown size={9} style={{ marginLeft: "auto", opacity: 0.3 }} />
          ) : (
            <ChevronRight size={9} style={{ marginLeft: "auto", opacity: 0.3 }} />
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
                    padding: "2px 0",
                    fontSize: 9,
                    color: isDone
                      ? (isPanel ? "var(--sk-t4, rgba(255,255,255,0.18))" : "rgba(255,255,255,0.18)")
                      : (isPanel ? "var(--sk-t3, rgba(255,255,255,0.3))" : "rgba(255,255,255,0.3)"),
                  }}
                >
                  {isDone ? (
                    <Check size={8} style={{ color: isPanel ? "var(--sk-green, #4ADE80)" : "#4ADE80", opacity: 0.5, flexShrink: 0 }} />
                  ) : (
                    <Loader2 size={8} className="animate-spin" style={{ color: "#F2903D", opacity: 0.6, flexShrink: 0 }} />
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

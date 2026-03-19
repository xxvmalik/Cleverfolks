"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Check } from "lucide-react";
import Image from "next/image";
import { HIDDEN_ACTIVITIES } from "@/lib/skyler/chat-constants";

type SkylerActivityStepsProps = {
  activities: string[];
  isComplete: boolean;
};

/**
 * Collapsible activity steps — rendered ABOVE the message bubble.
 * Orange (#F2903D) for all indicators. Collapsed by default.
 * Shows Skyler avatar (24px, 50% opacity) in header row.
 */
export function SkylerActivitySteps({
  activities,
  isComplete,
}: SkylerActivityStepsProps) {
  const [expanded, setExpanded] = useState(false);

  const steps = activities.filter((a) => !HIDDEN_ACTIVITIES.has(a));
  if (steps.length === 0) return null;

  return (
    <div style={{ animation: "sk-fadeIn 0.2s ease" }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2 w-full text-left"
        style={{
          padding: "4px 6px",
          borderRadius: 6,
          background: "rgba(242,144,61,0.04)",
          border: "1px solid rgba(242,144,61,0.08)",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        {/* Skyler avatar — small */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            overflow: "hidden",
            flexShrink: 0,
            opacity: 0.5,
          }}
        >
          <Image
            src="/skyler-icons/skyler-avatar.png"
            alt="Skyler"
            width={24}
            height={24}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        {/* Check circle */}
        {isComplete && (
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "rgba(242,144,61,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Check size={8} style={{ color: "#F2903D" }} />
          </div>
        )}

        {/* Label */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "rgba(255,255,255,0.18)",
          }}
        >
          {isComplete
            ? `Done — ${steps.length} step${steps.length !== 1 ? "s" : ""}`
            : steps[steps.length - 1]}
        </span>

        {/* Chevron — right-aligned */}
        {expanded ? (
          <ChevronDown
            size={9}
            style={{ marginLeft: "auto", color: "rgba(255,255,255,0.12)" }}
          />
        ) : (
          <ChevronRight
            size={9}
            style={{ marginLeft: "auto", color: "rgba(255,255,255,0.12)" }}
          />
        )}
      </button>

      {/* Expanded steps list */}
      {expanded && (
        <div style={{ paddingLeft: 20, marginTop: 4 }}>
          {steps.map((step, i) => (
            <div
              key={`${step}-${i}`}
              className="flex items-center gap-1.5"
              style={{
                padding: "2px 0",
                fontSize: 10,
                color: "rgba(255,255,255,0.15)",
              }}
            >
              <Check
                size={8}
                style={{ color: "#F2903D", flexShrink: 0, opacity: 0.7 }}
              />
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

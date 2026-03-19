"use client";

import Image from "next/image";

/**
 * Maps raw activity/tool-call strings to human-friendly labels.
 */
function getToolLabel(activity: string): string {
  const a = activity.toLowerCase();
  if (a.includes("check_calendar") || a.includes("calendar_availability"))
    return "Checking your calendar...";
  if (a.includes("create_calendar") || a.includes("schedule"))
    return "Creating the meeting...";
  if (a.includes("booking_link") || a.includes("get_booking"))
    return "Getting your booking link...";
  if (a.includes("draft_email") || a.includes("compose_email"))
    return "Drafting an email...";
  if (
    a.includes("pipeline") ||
    a.includes("lead") ||
    a.includes("deal") ||
    a.includes("sales")
  )
    return "Checking the pipeline...";
  if (a.includes("email") || a.includes("thread") || a.includes("outreach"))
    return "Reviewing emails...";
  if (a.includes("meeting") || a.includes("transcript") || a.includes("call"))
    return "Checking meetings...";
  if (a.includes("search") || a.includes("query") || a.includes("lookup") || a.includes("look_up"))
    return "Looking things up...";
  return "Working on it...";
}

type SkylerThinkingIndicatorProps = {
  /** Whether the assistant is currently streaming */
  isStreaming: boolean;
  /** Activity steps received so far */
  streamingActivities: string[];
  /** Whether streaming content has started (text tokens arriving) */
  hasContent: boolean;
  /** Whether the response is fully complete */
  isComplete: boolean;
};

/**
 * Three-state thinking indicator:
 * - State A: "Skyler is thinking..." (no activities, no content)
 * - State B: Tool call in progress (activities exist, no content yet)
 * - Hidden: once content starts streaming or response is complete
 */
export function SkylerThinkingIndicator({
  isStreaming,
  streamingActivities,
  hasContent,
  isComplete,
}: SkylerThinkingIndicatorProps) {
  // Don't render if not streaming, or if text has started, or if complete
  if (!isStreaming || hasContent || isComplete) return null;

  const hasActivities = streamingActivities.length > 0;
  const label = hasActivities
    ? getToolLabel(streamingActivities[streamingActivities.length - 1])
    : "Skyler is thinking...";

  return (
    <div
      className="flex items-start gap-2.5"
      style={{ animation: "sk-fadeIn 0.2s ease" }}
    >
      {/* Avatar with pulsing glow */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          overflow: "hidden",
          flexShrink: 0,
          animation: "sk-avatarGlow 2s ease-in-out infinite",
        }}
      >
        <Image
          src="/skyler-icons/skyler-avatar.png"
          alt="Skyler"
          width={28}
          height={28}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <div className="flex flex-col gap-1.5" style={{ paddingTop: 4 }}>
        {/* Pulsing dots */}
        <div className="flex items-center gap-1.5">
          {[0, 0.2, 0.4].map((delay, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#F2903D",
                animation: `sk-dotPulse 1.4s ease-in-out ${delay}s infinite`,
              }}
            />
          ))}
        </div>

        {/* Label text */}
        <span
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.18)",
            animation: "sk-thinkingText 2s ease-in-out infinite",
          }}
        >
          {label}
        </span>

        {/* Progress bar — only in State B (tool calls) */}
        {hasActivities && (
          <div
            style={{
              width: 140,
              height: 2,
              borderRadius: 1,
              background: "rgba(242,144,61,0.08)",
              overflow: "hidden",
              marginTop: 2,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "rgba(242,144,61,0.5)",
                animation: "sk-progressSweep 1.8s ease-in-out infinite",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

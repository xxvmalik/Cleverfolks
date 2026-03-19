"use client";

import Image from "next/image";
import { SkylerActivitySteps } from "./SkylerActivitySteps";

type SkylerMessageProps = {
  role: "user" | "assistant";
  content: string;
  activities?: string[];
  /** Only used for user messages with a tagged lead */
  taggedLeadName?: string;
  /** Whether this is a streaming message (shows cursor) */
  isStreaming?: boolean;
  /** Compact mode for Sales Closer panel (smaller font/padding) */
  compact?: boolean;
};

/**
 * Shared message bubble for Skyler chat.
 * - Assistant messages: avatar (28px) left + bubble
 * - User messages: right-aligned, no avatar
 */
export function SkylerMessage({
  role,
  content,
  activities,
  taggedLeadName,
  isStreaming = false,
  compact = false,
}: SkylerMessageProps) {
  const isUser = role === "user";

  const fontSize = compact ? 11 : 14;
  const padding = compact ? "10px 14px" : "10px 16px";
  const maxWidth = compact ? "88%" : "85%";
  const lineHeight = compact ? 1.6 : 1.65;

  return (
    <div style={{ animation: "sk-messageIn 0.3s var(--sk-ease-out)" }}>
      {/* Activity steps — ABOVE the message for assistant messages */}
      {!isUser && activities && activities.length > 0 && (
        <div style={{ marginBottom: 6, marginLeft: compact ? 0 : 36 }}>
          <SkylerActivitySteps activities={activities} isComplete={true} />
        </div>
      )}

      <div className={`flex ${isUser ? "justify-end" : "items-start gap-2.5"}`}>
        {/* Skyler avatar — only on assistant messages */}
        {!isUser && (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              overflow: "hidden",
              flexShrink: 0,
              marginTop: 2,
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
        )}

        <div style={{ maxWidth }}>
          {/* Tagged lead chip — above user messages */}
          {isUser && taggedLeadName && (
            <div
              className="flex items-center gap-1 mb-1"
              style={{
                fontSize: compact ? 9 : 10,
                color: "rgba(255,255,255,0.18)",
                justifyContent: "flex-end",
              }}
            >
              <span style={{ color: "#F2903D" }}>@</span>
              <span>{taggedLeadName}</span>
            </div>
          )}

          {/* Message bubble */}
          <div
            style={{
              background: isUser
                ? "rgba(242,144,61,0.09)"
                : compact
                  ? "var(--sk-card, #212121)"
                  : "#1A1714",
              border: isUser
                ? "none"
                : compact
                  ? "1px solid var(--sk-border, rgba(255,255,255,0.06))"
                  : "1px solid #2A2520",
              color: isUser
                ? "rgba(255,255,255,0.8)"
                : compact
                  ? "var(--sk-t2, rgba(255,255,255,0.55))"
                  : "#E0E0E0",
              borderRadius: isUser ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
              padding,
              fontSize,
              lineHeight,
              whiteSpace: "pre-wrap" as const,
              overflowWrap: "break-word" as const,
              wordBreak: "break-word" as const,
            }}
          >
            {content}
            {/* Streaming cursor */}
            {isStreaming && (
              <span
                className="inline-block animate-pulse"
                style={{
                  width: 6,
                  height: compact ? 14 : 16,
                  marginLeft: 2,
                  background: "#F2903D",
                  borderRadius: 1,
                  verticalAlign: "text-bottom",
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

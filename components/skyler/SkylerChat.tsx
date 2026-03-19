"use client";

import { useEffect, useRef } from "react";
import { SkylerMessage } from "./SkylerMessage";
import { SkylerThinkingIndicator } from "./SkylerThinkingIndicator";
import { SkylerActivitySteps } from "./SkylerActivitySteps";
import type { ChatMessage } from "@/lib/skyler/use-skyler-chat";

type SkylerChatProps = {
  messages: ChatMessage[];
  streamingContent: string;
  streamingActivities: string[];
  activitiesDone: boolean;
  isStreaming: boolean;
  /** Compact mode for Sales Closer panel (smaller sizing) */
  compact?: boolean;
  /** Name of the tagged lead (shown on user messages) */
  taggedLeadName?: string;
};

/**
 * Shared Skyler chat messages area.
 * Renders: historical messages → thinking indicator → live activity steps → streaming message.
 * Used by both Sales Closer and Lead Qualification.
 */
export function SkylerChat({
  messages,
  streamingContent,
  streamingActivities,
  activitiesDone,
  isStreaming,
  compact = false,
  taggedLeadName,
}: SkylerChatProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth auto-scroll debounced to every 100ms
  useEffect(() => {
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollTimerRef.current = null;
    }, 100);
  }, [messages, streamingContent, streamingActivities]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const activitiesComplete = streamingContent.length > 0 || activitiesDone;
  const gap = compact ? 12 : 16;

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: compact ? "12px 12px" : "16px 20px" }}
    >
      <div className="flex flex-col" style={{ gap }}>
        {/* Historical messages */}
        {messages.map((msg) => (
          <SkylerMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            activities={msg.role === "assistant" ? msg.activities : undefined}
            taggedLeadName={
              msg.role === "user" && msg.taggedLead
                ? msg.taggedLead.name
                : undefined
            }
            compact={compact}
          />
        ))}

        {/* Thinking indicator — State A (thinking) or State B (tool calls) */}
        <SkylerThinkingIndicator
          isStreaming={isStreaming}
          streamingActivities={streamingActivities}
          hasContent={streamingContent.length > 0}
          isComplete={activitiesDone}
        />

        {/* Live activity steps — shown above streaming bubble once text starts */}
        {streamingActivities.length > 0 && streamingContent.length > 0 && (
          <div style={{ marginLeft: compact ? 0 : 36 }}>
            <SkylerActivitySteps
              activities={streamingActivities}
              isComplete={activitiesComplete}
            />
          </div>
        )}

        {/* Streaming message */}
        {streamingContent && (
          <SkylerMessage
            role="assistant"
            content={streamingContent}
            isStreaming={true}
            compact={compact}
          />
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

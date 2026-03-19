"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";
import { HealthDot } from "../shared/health-dot";
import type { ChatMessage } from "../types";

function ActivitySteps({ activities, isComplete }: { activities: string[]; isComplete: boolean }) {
  const [expanded, setExpanded] = useState(true);

  if (activities.length === 0) return null;

  // Filter out "Generating response..." — that's just the final step
  const steps = activities.filter((a) => a !== "Generating response...");
  if (steps.length === 0) return null;

  return (
    <div
      className="flex justify-start"
      style={{ animation: "sk-messageIn 0.3s var(--sk-ease-out)" }}
    >
      <div style={{ maxWidth: "88%", overflowWrap: "break-word", wordBreak: "break-word" }}>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 w-full text-left"
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(242,144,61,0.06)",
            border: "1px solid rgba(242,144,61,0.12)",
            fontSize: 10,
            fontWeight: 500,
            color: "var(--sk-orange)",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
        >
          {isComplete ? (
            <Check size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
          ) : (
            <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0 }} />
          )}
          <span>
            {isComplete
              ? `Done — ${steps.length} step${steps.length !== 1 ? "s" : ""}`
              : steps[steps.length - 1]}
          </span>
          {expanded ? (
            <ChevronDown size={10} style={{ marginLeft: "auto", opacity: 0.5 }} />
          ) : (
            <ChevronRight size={10} style={{ marginLeft: "auto", opacity: 0.5 }} />
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
                    fontSize: 10,
                    color: isDone ? "var(--sk-t3)" : "var(--sk-t2)",
                    animation: `sk-messageIn 0.2s var(--sk-ease-out) ${i * 0.05}s both`,
                  }}
                >
                  {isDone ? (
                    <Check size={9} style={{ color: "var(--sk-green)", flexShrink: 0 }} />
                  ) : (
                    <Loader2 size={9} className="animate-spin" style={{ color: "var(--sk-orange)", flexShrink: 0 }} />
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

export function ChatMessages({
  messages,
  streamingContent,
  streamingActivities,
  taggedLeadName,
}: {
  messages: ChatMessage[];
  streamingContent: string;
  streamingActivities: string[];
  taggedLeadName?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingActivities]);

  // Activities are "complete" once text starts streaming (i.e. Skyler is writing the response)
  const activitiesComplete = streamingContent.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              style={{ animation: `sk-messageIn 0.3s var(--sk-ease-out)` }}
            >
              <div style={{ maxWidth: "88%" }}>
                {/* Tagged lead chip */}
                {isUser && msg.taggedLead && (
                  <div className="flex items-center gap-1 mb-1" style={{ fontSize: 9, color: "var(--sk-t4)" }}>
                    <HealthDot score={null} />
                    <span>{msg.taggedLead.name}</span>
                  </div>
                )}
                <div
                  style={{
                    background: isUser ? "rgba(242,144,61,0.09)" : "var(--sk-card)",
                    border: isUser ? "none" : "1px solid var(--sk-border)",
                    color: isUser ? "rgba(255,255,255,0.8)" : "var(--sk-t2)",
                    borderRadius: isUser ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                    padding: "10px 14px",
                    fontSize: 11,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {/* Activity steps — show while Skyler is thinking/working */}
        {streamingActivities.length > 0 && (
          <ActivitySteps
            activities={streamingActivities}
            isComplete={activitiesComplete}
          />
        )}

        {/* Streaming message */}
        {streamingContent && (
          <div className="flex justify-start" style={{ animation: "sk-messageIn 0.3s var(--sk-ease-out)" }}>
            <div
              style={{
                maxWidth: "88%",
                background: "var(--sk-card)",
                border: "1px solid var(--sk-border)",
                color: "var(--sk-t2)",
                borderRadius: "12px 12px 12px 3px",
                padding: "10px 14px",
                fontSize: 11,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
                wordBreak: "break-word",
              }}
            >
              {streamingContent}
              <span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse" style={{ background: "var(--sk-orange)", borderRadius: 1 }} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

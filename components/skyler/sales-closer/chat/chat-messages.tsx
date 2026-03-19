"use client";

import { useEffect, useRef } from "react";
import { HealthDot } from "../shared/health-dot";
import { ActivitySteps } from "@/components/skyler/shared/activity-steps";
import type { ChatMessage } from "@/lib/skyler/use-skyler-chat";

export function ChatMessages({
  messages,
  streamingContent,
  streamingActivities,
  activitiesDone,
  taggedLeadName,
}: {
  messages: ChatMessage[];
  streamingContent: string;
  streamingActivities: string[];
  activitiesDone: boolean;
  taggedLeadName?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingActivities]);

  // Activities are "complete" once text starts streaming OR the response is done
  const activitiesComplete = streamingContent.length > 0 || activitiesDone;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id}>
              {/* Activities attached ABOVE the assistant message they belong to */}
              {!isUser && msg.activities && msg.activities.length > 0 && (
                <div className="mb-1.5">
                  <ActivitySteps
                    activities={msg.activities}
                    isComplete={true}
                    variant="panel"
                  />
                </div>
              )}
              <div
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                style={{ animation: "sk-messageIn 0.3s var(--sk-ease-out)" }}
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
            </div>
          );
        })}

        {/* Live activity steps — shown above the streaming bubble */}
        {streamingActivities.length > 0 && (
          <div className="mb-1.5">
            <ActivitySteps
              activities={streamingActivities}
              isComplete={activitiesComplete}
              variant="panel"
            />
          </div>
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

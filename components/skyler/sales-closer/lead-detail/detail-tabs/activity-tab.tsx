"use client";

import { useState } from "react";
import { Inbox, ChevronDown, ChevronUp } from "lucide-react";
import { EmailCardSkeleton } from "../../shared/skeleton-loaders";
import type { ConvoThreadEntry, PipelineEvent } from "../../types";

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function formatStageName(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Unified timeline entry ──────────────────────────────────────────────────

type TimelineEntry =
  | { kind: "email"; data: ConvoThreadEntry; timestamp: number }
  | { kind: "event"; data: PipelineEvent; timestamp: number };

// ── Expandable AI action ────────────────────────────────────────────────────

function AiActionCard({ event }: { event: PipelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payload = event.payload ?? {};
  const subject = (payload.subject as string) ?? "";
  const reasoning = (payload.reasoning as string) ?? "";
  const touch = payload.touch as number | undefined;

  return (
    <div
      style={{
        background: "rgba(242,144,61,0.05)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12 }}>✨</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--sk-orange)" }}>
            {touch ? `Touch ${touch}/5` : "AI Action"}
          </span>
          {subject && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sk-t2)" }}>{subject}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>{formatDate(event.created_at)}</span>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ color: "var(--sk-t4)" }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>
      {expanded && reasoning && (
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 8, lineHeight: 1.6 }}>
          {reasoning}
        </p>
      )}
    </div>
  );
}

// ── Event cards ─────────────────────────────────────────────────────────────

function NoShowEventCard({ event }: { event: PipelineEvent }) {
  const count = (event.payload?.no_show_count as number) ?? 1;
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderLeft: "3px solid #E54545",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12 }}>❌</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#E54545" }}>
            No-show detected{count > 1 ? ` (${count} total)` : ""}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>{formatDate(event.created_at)}</span>
      </div>
    </div>
  );
}

function StageChangeCard({ event }: { event: PipelineEvent }) {
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(0,134,255,0.08)",
              color: "var(--sk-blue)",
            }}
          >
            {formatStageName(event.from_stage ?? "?")} → {formatStageName(event.to_stage ?? "?")}
          </span>
          <span style={{ fontSize: 10, color: "var(--sk-t3)" }}>
            via {event.source}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>{formatDate(event.created_at)}</span>
      </div>
    </div>
  );
}

function GenericEventCard({ event }: { event: PipelineEvent }) {
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 10, color: "var(--sk-t3)" }}>
          {event.event_type.replace(/_/g, " ")}
          {event.source_detail ? ` — ${event.source_detail}` : ""}
        </span>
        <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>{formatDate(event.created_at)}</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ActivityTab({
  thread,
  pipelineEvents,
  loading,
  contactFirstName,
}: {
  thread: ConvoThreadEntry[];
  pipelineEvents?: PipelineEvent[];
  loading: boolean;
  contactFirstName: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3 mt-4">
        <EmailCardSkeleton />
        <EmailCardSkeleton />
      </div>
    );
  }

  // Build unified timeline
  const entries: TimelineEntry[] = [];

  for (const entry of thread) {
    entries.push({ kind: "email", data: entry, timestamp: new Date(entry.timestamp).getTime() });
  }

  for (const event of pipelineEvents ?? []) {
    entries.push({ kind: "event", data: event, timestamp: new Date(event.created_at).getTime() });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Inbox size={32} style={{ color: "rgba(255,255,255,0.06)" }} />
        <p style={{ fontSize: 12, color: "var(--sk-t4)", marginTop: 8 }}>No activity yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col mt-4" style={{ gap: 12 }}>
      {entries.map((entry, i) => {
        if (entry.kind === "email") {
          return <EmailCard key={`email-${i}`} entry={entry.data} contactFirstName={contactFirstName} index={i} />;
        }

        const evt = entry.data;
        if (evt.event_type === "no_show_detected") {
          return <NoShowEventCard key={`event-${evt.id}`} event={evt} />;
        }
        if (evt.event_type === "reengagement_touch") {
          return <AiActionCard key={`event-${evt.id}`} event={evt} />;
        }
        if (evt.event_type === "stage_changed") {
          return <StageChangeCard key={`event-${evt.id}`} event={evt} />;
        }
        return <GenericEventCard key={`event-${evt.id}`} event={evt} />;
      })}
    </div>
  );
}

// ── Email card (extracted from original) ────────────────────────────────────

function EmailCard({ entry, contactFirstName, index }: { entry: ConvoThreadEntry; contactFirstName: string; index: number }) {
  const isSent = entry.role === "skyler" || entry.role === "sent" || entry.role === "user";
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "14px 16px",
        animation: `sk-contentIn 0.25s var(--sk-ease-out) ${index * 30}ms both`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
              background: isSent ? "rgba(242,144,61,0.08)" : "rgba(62,207,142,0.08)",
              color: isSent ? "var(--sk-orange)" : "var(--sk-green)",
            }}
          >
            {isSent ? "You" : contactFirstName}
          </span>
          {entry.subject && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sk-t2)" }}>{entry.subject}</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>{formatDate(entry.timestamp)}</span>
      </div>
      {/* Body */}
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
        {entry.content}
      </p>
    </div>
  );
}

"use client";

import { Inbox } from "lucide-react";
import { EmailCardSkeleton } from "../../shared/skeleton-loaders";
import type { ConvoThreadEntry } from "../../types";

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

export function ActivityTab({
  thread,
  loading,
  contactFirstName,
}: {
  thread: ConvoThreadEntry[];
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

  if (thread.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Inbox size={32} style={{ color: "rgba(255,255,255,0.06)" }} />
        <p style={{ fontSize: 12, color: "var(--sk-t4)", marginTop: 8 }}>No email activity yet</p>
      </div>
    );
  }

  const sorted = [...thread].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <div className="flex flex-col mt-4" style={{ gap: 12 }}>
      {sorted.map((entry, i) => {
        const isSent = entry.role === "skyler" || entry.role === "sent" || entry.role === "user";
        return (
          <div
            key={i}
            style={{
              background: "var(--sk-card-lead)",
              border: "1px solid var(--sk-border)",
              borderRadius: 10,
              padding: "14px 16px",
              animation: `sk-contentIn 0.25s var(--sk-ease-out) ${i * 30}ms both`,
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
      })}
    </div>
  );
}

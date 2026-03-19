"use client";

import type { PerformanceMetrics } from "./types";

const METRICS: { key: keyof PerformanceMetrics; label: string; suffix?: string }[] = [
  { key: "emailsSent", label: "EMAILS SENT" },
  { key: "replyRate", label: "REPLY RATE", suffix: "%" },
  { key: "meetingsBooked", label: "MEETINGS BOOKED" },
  { key: "dealsWon", label: "DEALS WON" },
  { key: "conversionRate", label: "CONVERSION", suffix: "%" },
];

export function MetricsBar({
  metrics,
  salesCloserEnabled,
  onToggle,
}: {
  metrics: PerformanceMetrics | null;
  salesCloserEnabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ background: "var(--sk-surface)" }}>
      {/* Header row */}
      <div className="flex items-center justify-between" style={{ padding: "14px 22px 10px" }}>
        <div className="flex items-center gap-3">
          <h1 style={{ fontSize: 16, fontWeight: 800, color: "var(--sk-t1)" }}>Sales Closer</h1>
          {/* Toggle */}
          <button
            onClick={onToggle}
            className="relative"
            style={{ width: 36, height: 20, borderRadius: 10, background: "#545454", transition: "background 0.2s" }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: salesCloserEnabled ? 18 : 2,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "var(--sk-orange)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                transition: "left 0.2s var(--sk-ease-out)",
              }}
            />
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--sk-t3)" }}>
          Skyler manages outreach, follow-ups, and conversations. All emails require your approval.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-5 gap-px" style={{ padding: "0 22px 14px" }}>
        {METRICS.map((m, i) => (
          <div
            key={m.key}
            style={{
              background: "var(--sk-card)",
              borderRadius: 8,
              padding: "12px 16px",
              animation: `sk-fadeSlideUp 0.35s var(--sk-ease-out) ${i * 20}ms both`,
            }}
          >
            <p style={{ fontSize: 9, fontWeight: 600, color: "var(--sk-t3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {m.label}
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, color: "var(--sk-t1)", marginTop: 2 }}>
              {metrics ? `${Math.round(metrics[m.key])}${m.suffix ?? ""}` : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

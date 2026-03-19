"use client";

import { X } from "lucide-react";
import type { AlertItem } from "../types";

function timeAgo(ts: string): string {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AlertsSection({
  alerts,
  onDismiss,
}: {
  alerts: AlertItem[];
  onDismiss: (id: string) => void;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ gap: 6, marginTop: 16 }}>
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-2"
          style={{
            background: "var(--sk-card-lead)",
            border: "1px solid var(--sk-border)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <span style={{ fontSize: 12, flexShrink: 0 }}>{alert.emoji}</span>
          <p className="flex-1" style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>
            {alert.text}
          </p>
          <span style={{ fontSize: 9, color: "var(--sk-t4)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {timeAgo(alert.timestamp)}
          </span>
          <button
            onClick={() => onDismiss(alert.id)}
            style={{ opacity: 0.3, flexShrink: 0 }}
            className="hover:opacity-60 transition-opacity"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

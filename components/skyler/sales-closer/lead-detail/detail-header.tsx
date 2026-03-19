"use client";

import { Send, Eye, CornerUpLeft, Clock } from "lucide-react";
import { StageBadge } from "../lead-list/stage-badge";
import { HealthCircle } from "../shared/health-circle";
import type { PipelineRecord } from "../types";

function daysSince(dateStr: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

export function DetailHeader({ record }: { record: PipelineRecord }) {
  const inStageDays = daysSince(record.updated_at);

  return (
    <div
      style={{
        background: "var(--sk-surface)",
        padding: "14px 22px 12px",
        borderBottom: "1px solid var(--sk-border)",
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        {/* Left: name + info */}
        <div>
          <div className="flex items-center gap-2">
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--sk-t1)" }}>{record.contact_name}</h2>
            <StageBadge stage={record.resolution ?? record.stage} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span style={{ fontSize: 11, color: "var(--sk-t2)" }}>{record.company_name}</span>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "rgba(255,255,255,0.12)" }} />
            <span style={{ fontSize: 11, color: "var(--sk-t3)" }}>{record.contact_email}</span>
          </div>
        </div>

        {/* Right: health + deal value */}
        <div className="flex items-center gap-4">
          <HealthCircle score={record.health_score ?? null} />
          {record.deal_value != null && (
            <>
              <div style={{ width: 1, height: 28, background: "var(--sk-border)" }} />
              <div className="text-right">
                <p style={{ fontSize: 20, fontWeight: 800, color: "var(--sk-t1)" }}>
                  £{Number(record.deal_value).toLocaleString()}
                </p>
                <p style={{ fontSize: 9, color: "var(--sk-t4)", textTransform: "uppercase" }}>DEAL VALUE</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom row: tags + stats */}
      <div className="flex items-center justify-between mt-3">
        {/* Tags */}
        <div className="flex gap-1.5">
          {(record.tags ?? []).map((tag) => (
            <span
              key={tag}
              style={{
                background: "var(--sk-card)",
                border: "1px solid var(--sk-border)",
                padding: "2px 10px",
                borderRadius: 999,
                fontSize: 10,
                color: "var(--sk-t3)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3">
          <StatItem icon={Send} label="Sent" value={record.emails_sent} />
          <StatItem icon={Eye} label="Opened" value={record.emails_opened} />
          <StatItem icon={CornerUpLeft} label="Replied" value={record.emails_replied} />
          <div style={{ width: 1, height: 16, background: "var(--sk-border)" }} />
          <div className="flex items-center gap-1">
            <Clock size={11} style={{ color: "var(--sk-t4)" }} />
            <span style={{ fontSize: 9, color: "var(--sk-t3)" }}>In stage</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
              {inStageDays} {inStageDays === 1 ? "day" : "days"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatItem({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={11} style={{ color: "var(--sk-t4)" }} />
      <span style={{ fontSize: 9, color: "var(--sk-t3)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{value}</span>
    </div>
  );
}

"use client";

import { Mail, AtSign } from "lucide-react";
import { HealthDot } from "../shared/health-dot";
import { StageBadge } from "./stage-badge";
import type { PipelineRecord } from "../types";

export function LeadCard({
  record,
  selected,
  onSelect,
  onTag,
}: {
  record: PipelineRecord;
  selected: boolean;
  onSelect: () => void;
  onTag: () => void;
}) {
  const hasPending = (record.pending_actions?.length ?? 0) > 0;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left group"
      style={{
        background: "var(--sk-card-lead)",
        border: selected
          ? "1px solid rgba(242,144,61,0.27)"
          : "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "12px 14px",
        transition: "border-color 0.2s var(--sk-ease-out), background 0.15s var(--sk-ease-out), transform 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.borderColor = "var(--sk-border)";
      }}
    >
      {/* Row 1: Name + icons */}
      <div className="flex items-center gap-1.5">
        <HealthDot score={record.health_score ?? null} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sk-t1)" }} className="truncate flex-1">
          {record.contact_name}
        </span>
        {hasPending && (
          <Mail size={11} style={{ color: "var(--sk-orange)", opacity: 0.6 }} className="shrink-0" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onTag(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(242,144,61,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <AtSign size={11} style={{ color: "var(--sk-orange)" }} />
        </button>
      </div>

      {/* Row 2: Company + stage */}
      <div className="flex items-center justify-between mt-1">
        <span style={{ fontSize: 10, color: "var(--sk-t3)" }} className="truncate">
          {record.company_name}
        </span>
        <StageBadge stage={record.resolution ?? record.stage} />
      </div>

      {/* Row 3: Stats */}
      <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 9, color: "var(--sk-t4)" }}>
        <span>{record.emails_sent} sent</span>
        <span style={{ width: 2, height: 2, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
        <span>{record.emails_replied} replied</span>
        {record.deal_value != null && (
          <>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
            <span>£{Number(record.deal_value).toLocaleString()}</span>
          </>
        )}
      </div>
    </button>
  );
}

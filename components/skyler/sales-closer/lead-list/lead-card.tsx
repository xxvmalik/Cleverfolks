"use client";

import { Mail, AtSign } from "lucide-react";
import { HealthDot } from "../shared/health-dot";
import { StageBadge } from "./stage-badge";
import type { PipelineRecord } from "../types";

function relativeTimeShort(date: string): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);

  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  return future ? `in ${days}d` : `${days}d ago`;
}

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
  const isNoShow = (record.no_show_count ?? 0) > 0;
  const isReengaging = record.re_engagement_status === "active";

  return (
    <button
      onClick={onSelect}
      className="w-full text-left group"
      data-entity-type="lead"
      data-entity-id={record.id}
      data-entity-name={record.contact_name}
      style={{
        background: "var(--sk-card-lead)",
        border: selected
          ? "1px solid rgba(242,144,61,0.27)"
          : "1px solid var(--sk-border)",
        borderLeft: isReengaging
          ? "3px solid var(--sk-orange)"
          : selected
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

      {/* Row 1.5: No-show + re-engaging badges */}
      {isNoShow && (
        <div className="flex items-center gap-1.5 mt-1">
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: record.re_engagement_status === "completed"
                ? "rgba(255,255,255,0.04)"
                : "rgba(229,69,69,0.1)",
              color: record.re_engagement_status === "completed"
                ? "var(--sk-t4)"
                : "#E54545",
            }}
          >
            NO-SHOW
          </span>
          {isReengaging && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(242,144,61,0.1)",
                color: "#F2903D",
              }}
            >
              RE-ENGAGING
            </span>
          )}
        </div>
      )}

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

      {/* Row 4: Re-engagement action summary */}
      {isReengaging && record.last_re_engagement_action && (
        <div className="mt-1.5" style={{ fontSize: 9, color: "var(--sk-t4)" }}>
          <div>✨ {record.last_re_engagement_action.summary}</div>
          {record.next_re_engagement_at && (
            <div>Next: Follow-up {relativeTimeShort(record.next_re_engagement_at)}</div>
          )}
        </div>
      )}
    </button>
  );
}

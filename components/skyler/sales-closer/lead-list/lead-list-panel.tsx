"use client";

import { Search } from "lucide-react";
import { LeadCard } from "./lead-card";
import { getPhaseForStage } from "./stage-badge";
import { LeadCardSkeleton } from "../shared/skeleton-loaders";
import type { PipelineRecord } from "../types";

type PhaseFilter = "all" | "prospecting" | "engaged" | "resolved";

const PHASE_PILLS: { id: PhaseFilter; label: string; color?: string }[] = [
  { id: "all", label: "All" },
  { id: "prospecting", label: "Prospecting", color: "#0086FF" },
  { id: "engaged", label: "Engaged", color: "#F2903D" },
  { id: "resolved", label: "Resolved", color: "#3ECF8E" },
];

export function LeadListPanel({
  records,
  loading,
  selectedId,
  phaseFilter,
  searchQuery,
  onSelectLead,
  onTagLead,
  onPhaseFilterChange,
  onSearchChange,
}: {
  records: PipelineRecord[];
  loading: boolean;
  selectedId: string | null;
  phaseFilter: PhaseFilter;
  searchQuery: string;
  onSelectLead: (id: string) => void;
  onTagLead: (id: string) => void;
  onPhaseFilterChange: (f: PhaseFilter) => void;
  onSearchChange: (q: string) => void;
}) {
  const filtered = records.filter((r) => {
    if (phaseFilter !== "all" && getPhaseForStage(r.resolution ?? r.stage) !== phaseFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.contact_name.toLowerCase().includes(q) ||
        r.company_name.toLowerCase().includes(q) ||
        r.contact_email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingCount = records.filter((r) => (r.pending_actions?.length ?? 0) > 0).length;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 260,
        minWidth: 260,
        borderRight: "1px solid var(--sk-border)",
        animation: "sk-fadeSlideUp 0.4s var(--sk-ease-out) forwards",
      }}
    >
      {/* Search */}
      <div style={{ padding: "12px 8px 4px" }}>
        <div className="relative">
          <Search
            size={13}
            className="absolute"
            style={{ left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--sk-t4)" }}
          />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search leads..."
            style={{
              width: "100%",
              background: "var(--sk-card)",
              border: "1px solid var(--sk-border)",
              borderRadius: 7,
              padding: "8px 10px 8px 28px",
              fontSize: 11,
              color: "var(--sk-t1)",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Phase filter pills */}
      <div className="flex gap-1" style={{ padding: "6px 8px" }}>
        {PHASE_PILLS.map((p) => {
          const active = phaseFilter === p.id;
          const color = active ? (p.color ?? "#fff") : undefined;
          return (
            <button
              key={p.id}
              onClick={() => onPhaseFilterChange(p.id)}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                fontSize: 9,
                fontWeight: 600,
                background: active ? `${color}14` : "transparent",
                border: active ? `1px solid ${color}30` : "1px solid transparent",
                color: active ? color : "var(--sk-t3)",
                transition: "all 0.15s",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Lead cards */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "4px 8px" }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          {loading ? (
            <>
              <LeadCardSkeleton />
              <LeadCardSkeleton />
              <LeadCardSkeleton />
            </>
          ) : filtered.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--sk-t4)", textAlign: "center", padding: 20 }}>
              No leads found
            </p>
          ) : (
            filtered.map((r) => (
              <LeadCard
                key={r.id}
                record={r}
                selected={selectedId === r.id}
                onSelect={() => onSelectLead(r.id)}
                onTag={() => onTagLead(r.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between"
        style={{
          borderTop: "1px solid var(--sk-border)",
          padding: "10px 12px",
          fontSize: 9,
          color: "var(--sk-t4)",
        }}
      >
        <span>{filtered.length} leads</span>
        <span>{pendingCount} pending</span>
      </div>
    </div>
  );
}

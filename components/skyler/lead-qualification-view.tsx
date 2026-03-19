"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadPriority = "High" | "Medium" | "Low";

type Lead = {
  id: string;
  contact_id?: string;
  company: string;
  contact_name?: string;
  contact_email?: string;
  priority: LeadPriority;
  potential: string;
  detail: string;
  total_score?: number;
  classification?: string;
  dimension_scores?: Record<string, { score: number; reasoning: string }>;
  is_referral?: boolean;
  referrer_name?: string;
  stage?: string;
  probability?: number;
};

type LeadFilter = "all" | "hot" | "nurture" | "disqualified";

type IntegrationLogo = {
  provider: string;
  logoUrl: string;
};

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 bg-[#212121] border border-[#2A2D35]/40 rounded-xl px-5 py-4">
      <p className="text-[#8B8F97] text-xs mb-1">{label}</p>
      <p className="text-white font-bold text-2xl">{value}</p>
    </div>
  );
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-[52px] h-[28px] rounded-full relative transition-colors flex-shrink-0",
        "bg-[#545454]"
      )}
    >
      <div
        className={cn(
          "w-[22px] h-[22px] rounded-full absolute top-[3px] transition-all",
          enabled ? "left-[27px] bg-[#F2903D]" : "left-[3px] bg-[#8B8F97]"
        )}
      />
    </button>
  );
}

function LeadCard({
  lead,
  isActive,
  onClick,
}: {
  lead: Lead;
  isActive: boolean;
  onClick: () => void;
}) {
  const priorityColor = {
    High: "#F87171",
    Medium: "#FB923C",
    Low: "#8B8F97",
  }[lead.priority];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-xl border transition-all",
        isActive
          ? "bg-[#211F1E] border-[#F2903D]/50"
          : "bg-[#211F1E] border-[#473E38] hover:border-[#5A4E46]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-semibold text-sm">{lead.company}</span>
            <span className="flex items-center gap-1 text-xs" style={{ color: priorityColor }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: priorityColor }} />
              {lead.priority}
            </span>
          </div>
          <p className="text-[#8B8F97] text-xs">
            Potential: {lead.potential} &bull; {lead.detail}
          </p>
        </div>
      </div>
    </button>
  );
}

// ── Main View ────────────────────────────────────────────────────────────────

export function LeadQualificationView({ workspaceId }: { workspaceId: string }) {
  const [leadQualEnabled, setLeadQualEnabled] = useState(true);
  const [salesCloserEnabled, setSalesCloserEnabled] = useState(false);
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState({ qualificationRate: 0, hotLeads: 0, nurtureQueue: 0, disqualified: 0 });
  const [integrationLogos, setIntegrationLogos] = useState<IntegrationLogo[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [leadStatsRes, leadsRes, dashRes, logosRes] = await Promise.all([
        fetch(`/api/skyler/lead-stats?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/leads?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/dashboard?workspaceId=${workspaceId}`),
        fetch(`/api/integration-logos?workspaceId=${workspaceId}`),
      ]);

      let usedLeadScores = false;
      if (leadStatsRes.ok && leadsRes.ok) {
        const statsData = await leadStatsRes.json();
        const leadsData = await leadsRes.json();
        if (statsData.stats?.totalScored > 0) {
          usedLeadScores = true;
          setStats(statsData.stats);
          setLeads(leadsData.leads ?? []);
          if (dashRes.ok) {
            const oldData = await dashRes.json();
            setSalesCloserEnabled(oldData.salesCloserEnabled ?? false);
          }
        }
      }

      if (!usedLeadScores && dashRes.ok) {
        const data = await dashRes.json();
        setStats(data.stats ?? { qualificationRate: 0, hotLeads: 0, nurtureQueue: 0, disqualified: 0 });
        setLeads(data.leads ?? []);
        setSalesCloserEnabled(data.salesCloserEnabled ?? false);
      }

      if (logosRes.ok) {
        const data = await logosRes.json();
        setIntegrationLogos(data.logos ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSalesCloserToggle = async () => {
    const newValue = !salesCloserEnabled;
    setSalesCloserEnabled(newValue);
    await fetch("/api/skyler/dashboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, salesCloserEnabled: newValue }),
    });
  };

  const filteredLeads = leads.filter((lead) => {
    if (leadFilter === "all") return true;
    if (lead.classification) {
      return lead.classification === leadFilter;
    }
    if (leadFilter === "hot") return lead.priority === "High";
    if (leadFilter === "nurture") return lead.priority === "Medium" || lead.priority === "Low";
    if (leadFilter === "disqualified") return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--sk-bg, #0E0E0E)" }}>
      {/* Header */}
      <div className="bg-[#111111] px-6 py-5 border-b border-[#2A2D35]/30">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <h2 className="text-white font-bold text-lg">Lead Qualification Automation</h2>
              <ToggleSwitch enabled={leadQualEnabled} onToggle={() => setLeadQualEnabled((v) => !v)} />
            </div>
            <p className="text-[#8B8F97] text-sm">
              Automatically qualifies incoming leads using sales-specific criteria and routes them appropriately
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {integrationLogos.length > 0 ? (
              integrationLogos.map((logo) => (
                <div key={logo.provider} className="w-8 h-8 rounded-full overflow-hidden bg-[#2A2D35] flex items-center justify-center">
                  <Image src={logo.logoUrl} alt={logo.provider} width={32} height={32} />
                </div>
              ))
            ) : (
              <span className="text-[#555A63] text-xs">No integrations connected</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-6 py-4 flex gap-4">
        <StatCard label="Qualification Rate" value={loading ? "..." : `${stats.qualificationRate}%`} />
        <StatCard label="Hot Leads" value={loading ? "..." : String(stats.hotLeads)} />
        <StatCard label="Nurture Queue" value={loading ? "..." : String(stats.nurtureQueue)} />
        <StatCard label="Disqualified" value={loading ? "..." : String(stats.disqualified)} />
      </div>

      {/* Sales Closer Permission Bar */}
      <div className="mx-6 mb-4 bg-[#1F1F1F] border border-[#2A2D35]/40 rounded-xl px-5 py-4 flex items-center justify-between">
        <div>
          <span className="text-white font-semibold text-sm">Sales Closer</span>
          <span className="text-[#8B8F97] text-sm ml-2">
            Skyler takes over the conversation handling questions, addressing objections, and booking demos.
          </span>
        </div>
        <ToggleSwitch enabled={salesCloserEnabled} onToggle={handleSalesCloserToggle} />
      </div>

      {/* Hot Leads list */}
      <div className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-white font-bold text-base">Hot Leads</h3>
          <div className="relative flex-1 max-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555A63]" />
            <input
              type="text"
              placeholder="Search"
              className="w-full bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 transition-colors"
            />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg text-[#8B8F97] text-xs hover:text-white transition-colors">
            <span>Today</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        <div className="flex gap-5 mb-3 border-b border-[#2A2D35]/40">
          {([
            ["all", "All Leads"],
            ["hot", "Hot leads"],
            ["nurture", "Nurture"],
            ["disqualified", "Disqualified"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setLeadFilter(key)}
              className={cn(
                "pb-2.5 text-sm transition-colors",
                leadFilter === key
                  ? "text-white border-b-2 border-white font-medium"
                  : "text-[#8B8F97] hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {loading ? (
            <p className="text-[#555A63] text-sm text-center py-8">Loading deals...</p>
          ) : filteredLeads.length === 0 ? (
            <p className="text-[#555A63] text-sm text-center py-8">
              {leads.length === 0
                ? "No deals found. Connect your CRM to import your pipeline."
                : "No leads match this filter."}
            </p>
          ) : (
            filteredLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                isActive={lead.id === activeLeadId}
                onClick={() => setActiveLeadId(lead.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

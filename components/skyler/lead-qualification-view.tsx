"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { Search, ChevronDown, Mail, Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkylerChat } from "@/lib/skyler/use-skyler-chat";
import { ActivitySteps } from "@/components/skyler/sales-closer/shared/activity-steps";

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

const QUICK_ACTIONS = [
  "Draft a follow up message",
  "Recommendation",
  "Skyler's AI Analysis",
  "Score this lead",
];

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
      className="w-[52px] h-[28px] rounded-full relative transition-colors flex-shrink-0 bg-[#545454]"
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
  onPrompt,
}: {
  lead: Lead;
  isActive: boolean;
  onClick: () => void;
  onPrompt: () => void;
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
        <button
          onClick={(e) => { e.stopPropagation(); onPrompt(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2A2A2A] hover:bg-[#353535] border border-[#3A3A3A] rounded-full text-white text-xs font-medium transition-colors flex-shrink-0"
        >
          <Image src="/skyler-icons/prompt-icon.png" alt="" width={14} height={14} className="invert" />
          Prompt
        </button>
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

  // Chat (shared hook)
  const [chatInput, setChatInput] = useState("");
  const [promptedLead, setPromptedLead] = useState<Lead | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chat = useSkylerChat({ workspaceId });

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

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.streamingContent, chat.streamingActivities]);

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
    if (lead.classification) return lead.classification === leadFilter;
    if (leadFilter === "hot") return lead.priority === "High";
    if (leadFilter === "nurture") return lead.priority === "Medium" || lead.priority === "Low";
    if (leadFilter === "disqualified") return false;
    return true;
  });

  // Prompt a lead into chat
  const handlePromptLead = (lead: Lead) => {
    setActiveLeadId(lead.id);
    setPromptedLead(lead);
  };

  // Send chat message via shared hook
  const handleSendMessage = async (text?: string) => {
    const message = text ?? chatInput.trim();
    if (!message || chat.isStreaming) return;

    setChatInput("");
    await chat.sendMessage({
      message,
      pipelineContext: promptedLead
        ? {
            source: "lead",
            pipeline_id: promptedLead.id,
            contact_name: promptedLead.contact_name ?? promptedLead.company,
            company_name: promptedLead.company,
            contact_email: promptedLead.contact_email,
            stage: promptedLead.stage,
          }
        : null,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const resizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const hasChatContent = chat.messages.length > 0 || chat.streamingContent;

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

      {/* Two-column: Hot Leads + Chat */}
      <div className="flex-1 flex px-6 pb-6 gap-5 min-h-0">
        {/* Left: Hot Leads */}
        <div className="w-[45%] flex flex-col min-h-0">
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
                  onPrompt={() => handlePromptLead(lead)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Chat with Skyler */}
        <div className="flex-1 flex flex-col min-h-0 bg-black rounded-xl overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2520]">
            <h3 className="text-white font-bold text-base">Chat with Skyler</h3>
            <button className="flex items-center gap-1.5 text-[#8B8F97] hover:text-white text-sm transition-colors">
              <Mail className="w-4 h-4" />
              Email Thread
            </button>
          </div>

          {/* Chat content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!hasChatContent ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  {promptedLead ? (
                    <>
                      <Image
                        src="/skyler-icons/skyler-avatar.png"
                        alt="Skyler"
                        width={64}
                        height={64}
                        className="rounded-full mx-auto mb-4 opacity-60 object-cover aspect-square"
                      />
                      <p className="text-[#8B8F97] text-sm">
                        Ask Skyler about <span className="text-white font-medium">{promptedLead.contact_name ?? promptedLead.company}</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <Image
                        src="/skyler-icons/skyler-avatar.png"
                        alt="Skyler"
                        width={64}
                        height={64}
                        className="rounded-full mx-auto mb-4 opacity-40 object-cover aspect-square"
                      />
                      <p className="text-[#555A63] text-sm">
                        Select a lead to Prompt
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {chat.messages.map((msg) => (
                  <div key={msg.id}>
                    {/* Activity steps attached above assistant messages */}
                    {msg.role === "assistant" && msg.activities && msg.activities.length > 0 && (
                      <div className="mb-2">
                        <ActivitySteps activities={msg.activities} isComplete={true} variant="inline" />
                      </div>
                    )}
                    <div className={cn("flex gap-3 items-start", msg.role === "user" ? "justify-end" : "")}>
                      {msg.role === "assistant" && (
                        <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                          <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={28} height={28} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%]",
                          msg.role === "user"
                            ? "bg-[#F2903D]/20 text-white"
                            : "bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]"
                        )}
                        style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Live activity steps — shown above the streaming bubble */}
                {chat.streamingActivities.length > 0 && (
                  <div className="mb-2">
                    <ActivitySteps
                      activities={chat.streamingActivities}
                      isComplete={chat.streamingContent.length > 0 || chat.activitiesDone}
                      variant="inline"
                    />
                  </div>
                )}

                {/* Streaming */}
                {chat.streamingContent && (
                  <div className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                      <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={28} height={28} className="w-full h-full object-cover" />
                    </div>
                    <div
                      className="rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]"
                      style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}
                    >
                      {chat.streamingContent}
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse bg-[#F2903D]" style={{ borderRadius: 1 }} />
                    </div>
                  </div>
                )}

                {/* Fallback thinking spinner — only shows before any activities arrive */}
                {chat.isStreaming && !chat.streamingContent && chat.streamingActivities.length === 0 && (
                  <div className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                      <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={28} height={28} className="w-full h-full object-cover" />
                    </div>
                    <div className="rounded-xl px-4 py-2.5 text-sm bg-[#1A1714] border border-[#2A2520] text-[#8B8F97] flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-xs">Thinking...</span>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Quick actions */}
          {!hasChatContent && promptedLead && (
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-2 mb-3">
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => void handleSendMessage(action)}
                    className="px-3 py-1.5 bg-[#1A1A1A] border border-[#2A2D35] rounded-full text-[#8B8F97] text-xs hover:text-white hover:border-[#3A3D45] transition-colors"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input bar */}
          <div className="px-4 pb-4">
            {/* Pinned lead context */}
            {promptedLead && (
              <div className="mb-2 rounded-lg bg-[#1a1d21] border-l-[3px] border-l-[#F2903D] px-3 py-2 flex items-center gap-2">
                <span className="text-[#F2903D] text-xs font-semibold truncate">
                  {promptedLead.contact_name ?? promptedLead.company}
                  {promptedLead.company && promptedLead.contact_name ? ` · ${promptedLead.company}` : ""}
                </span>
                <button
                  onClick={() => setPromptedLead(null)}
                  className="text-[#555A63] hover:text-white transition-colors flex-shrink-0 ml-auto text-xs"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 bg-[#2B2B2B] rounded-2xl px-4 py-3 focus-within:ring-1 focus-within:ring-[#F2903D]/50 transition-all">
              <button type="button" className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                <Image
                  src="/cleverbrain-chat-icons/add-media-icon.png"
                  alt="Attach"
                  width={20}
                  height={20}
                  className="opacity-60 hover:opacity-100"
                />
              </button>
              <button type="button" className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                <Mic className="w-5 h-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  resizeTextarea(e.target);
                }}
                onKeyDown={handleKeyDown}
                placeholder={promptedLead ? `Message Skyler about ${promptedLead.contact_name ?? promptedLead.company}...` : "Type a message here"}
                rows={1}
                disabled={chat.isStreaming}
                className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed disabled:opacity-50"
                style={{ maxHeight: "160px", overflowY: "auto" }}
              />
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                className="flex-shrink-0 pb-0.5 cursor-pointer"
                aria-label="Send message"
              >
                <Image
                  src="/cleverbrain-chat-icons/send-prompt-icon.png"
                  alt="Send"
                  width={24}
                  height={24}
                  className={cn("transition-opacity pointer-events-none", chatInput.trim() && !chat.isStreaming ? "opacity-100" : "opacity-40")}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

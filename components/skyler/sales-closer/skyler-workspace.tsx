"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { PanelLeftOpen, Bell, ChevronDown } from "lucide-react";
import { signOut } from "@/lib/auth";
import { SkylerSidebar, type WorkflowTab } from "./skyler-sidebar";
import { MetricsBar } from "./metrics-bar";
import { LeadListPanel } from "./lead-list/lead-list-panel";
import { LeadDetailPanel } from "./lead-detail/lead-detail-panel";
import { ChatPanel } from "./chat/chat-panel";
import { RightIconBar } from "./right-icon-bar";
import { WorkflowSettings } from "@/components/skyler/workflow-settings";
import { LeadQualificationView } from "@/components/skyler/lead-qualification-view";
import { useSkylerChat } from "@/lib/skyler/use-skyler-chat";
import type { ChatMessage } from "@/lib/skyler/use-skyler-chat";
import { usePageContext } from "@/hooks/usePageContext";
import type {
  PipelineRecord,
  PerformanceMetrics,
  ConversationItem,
  TaggedLead,
  AlertItem,
  DirectiveItem,
  CalendarEvent,
  MeetingRecord,
  PipelineEvent,
} from "./types";

type PhaseFilter = "all" | "prospecting" | "engaged" | "resolved";

export function SkylerWorkspace({
  workspaceId,
  userName,
  companyName,
}: {
  workspaceId: string;
  userName: string;
  companyName: string;
}) {
  // ── Pipeline state ──────────────────────────────────────────────
  const [pipelineRecords, setPipelineRecords] = useState<PipelineRecord[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [salesCloserEnabled, setSalesCloserEnabled] = useState(false);

  // ── Selection + filters ─────────────────────────────────────────
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Lead detail data ────────────────────────────────────────────
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [directives, setDirectives] = useState<DirectiveItem[]>([]);
  const [directivesLoading, setDirectivesLoading] = useState(false);
  const [upcomingMeetings, setUpcomingMeetings] = useState<CalendarEvent[]>([]);
  const [pastMeetings, setPastMeetings] = useState<MeetingRecord[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);

  // ── Sidebar state ───────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkflowTab>("sales-closer");
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // ── Chat state (shared hook) ────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(true);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [taggedLead, setTaggedLead] = useState<TaggedLead | null>(null);

  const fetchConversationsRef = useCallback(async () => {
    try {
      const res = await fetch(`/api/skyler/conversations?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations ?? []);
      }
    } catch {
      // Silently ignore
    }
  }, [workspaceId]);

  const { getPageContext, trackAction } = usePageContext("sales_closer");

  const chat = useSkylerChat({
    workspaceId,
    onResponseComplete: () => {
      fetchConversationsRef();
      fetchPipelineData();
    },
  });

  // ── Data fetching ───────────────────────────────────────────────

  const fetchPipelineData = useCallback(async () => {
    setPipelineLoading(true);
    try {
      const [pipelineRes, perfRes, dashRes] = await Promise.all([
        fetch(`/api/skyler/sales-pipeline?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/performance?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/dashboard?workspaceId=${workspaceId}`),
      ]);
      if (pipelineRes.ok) {
        const data = await pipelineRes.json();
        setPipelineRecords(data.records ?? []);
      }
      if (perfRes.ok) {
        const data = await perfRes.json();
        setPerformanceMetrics(data.metrics ?? null);
      }
      if (dashRes.ok) {
        const data = await dashRes.json();
        setSalesCloserEnabled(data.salesCloserEnabled ?? false);
      }
    } finally {
      setPipelineLoading(false);
    }
  }, [workspaceId]);

  // On mount
  useEffect(() => {
    fetchPipelineData();
    fetchConversationsRef();
  }, [fetchPipelineData, fetchConversationsRef]);

  // ── Lead selection side effects ─────────────────────────────────

  const selectedRecord = pipelineRecords.find((r) => r.id === selectedLeadId) ?? null;

  useEffect(() => {
    if (!selectedLeadId) {
      setAlerts([]);
      setDirectives([]);
      setUpcomingMeetings([]);
      setPastMeetings([]);
      setPipelineEvents([]);
      return;
    }

    // Fetch directives
    setDirectivesLoading(true);
    fetch(`/api/skyler/directives?pipelineId=${selectedLeadId}`)
      .then((res) => (res.ok ? res.json() : { directives: [] }))
      .then((data) => setDirectives(data.directives ?? []))
      .finally(() => setDirectivesLoading(false));

    // Fetch pipeline events for activity timeline
    fetch(`/api/skyler/pipeline-events?pipelineId=${selectedLeadId}`)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data) => setPipelineEvents(data.events ?? []))
      .catch(() => setPipelineEvents([]));

    // Fetch alerts (if endpoint exists)
    fetch(`/api/skyler/lead-alerts?pipelineId=${selectedLeadId}`)
      .then((res) => (res.ok ? res.json() : { alerts: [] }))
      .then((data) => setAlerts(data.alerts ?? []))
      .catch(() => setAlerts([]));

    // Fetch meetings (if endpoint exists)
    setMeetingsLoading(true);
    fetch(`/api/skyler/lead-meetings?pipelineId=${selectedLeadId}`)
      .then((res) => (res.ok ? res.json() : { upcoming: [], past: [] }))
      .then((data) => {
        setUpcomingMeetings(data.upcoming ?? []);
        setPastMeetings(data.past ?? []);
      })
      .catch(() => {
        setUpcomingMeetings([]);
        setPastMeetings([]);
      })
      .finally(() => setMeetingsLoading(false));
  }, [selectedLeadId]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleToggleSalesCloser = async () => {
    const newValue = !salesCloserEnabled;
    setSalesCloserEnabled(newValue);
    await fetch("/api/skyler/dashboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, salesCloserEnabled: newValue }),
    });
  };

  const handleSelectLead = (id: string) => {
    setSelectedLeadId(id);
    trackAction(`selected_lead:${id}`);
  };

  const handleTagLead = (id: string) => {
    const rec = pipelineRecords.find((r) => r.id === id);
    if (!rec) return;
    setTaggedLead({
      id: rec.id,
      name: rec.contact_name,
      company: rec.company_name,
      email: rec.contact_email,
      stage: rec.stage,
      healthScore: rec.health_score,
    });
    setChatOpen(true);
  };

  const handleApproveDraft = async (actionId: string, editedBody?: string) => {
    if (!selectedLeadId) return;
    try {
      const res = await fetch(`/api/skyler/sales-pipeline/${selectedLeadId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, editedBody }),
      });
      if (res.ok) fetchPipelineData();
    } catch {
      // Error handled at card level
    }
  };

  const handleRetryDraft = async (actionId: string) => {
    if (!selectedLeadId) return;
    try {
      // Reset to pending, then re-approve
      const res = await fetch(`/api/skyler/sales-pipeline/${selectedLeadId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, retry: true }),
      });
      if (res.ok) fetchPipelineData();
    } catch {
      // Error handled at card level
    }
  };

  const handleRejectDraft = async (actionId: string, feedback: string) => {
    if (!selectedLeadId) return;
    try {
      const res = await fetch(`/api/skyler/sales-pipeline/${selectedLeadId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, feedback }),
      });
      if (res.ok) fetchPipelineData();
    } catch {
      // Error handled at card level
    }
  };

  const handleDismissAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    fetch(`/api/skyler/lead-alerts?alertId=${id}`, { method: "PATCH" }).catch(() => {});
  };

  const handleReplyToRequest = (text: string) => {
    setChatInput(text);
    setChatOpen(true);
  };

  const handleDismissRequest = () => {
    // Dismiss the first pending request from the selected record
    // The request will disappear on next pipeline refresh
    fetchPipelineData();
  };

  const handleAddDirective = async (text: string) => {
    if (!selectedLeadId) return;
    try {
      const res = await fetch("/api/skyler/directives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId: selectedLeadId, directiveText: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setDirectives((prev) => [...prev, data.directive ?? { id: Date.now().toString(), directive_text: text, created_at: new Date().toISOString(), is_active: true }]);
      }
    } catch {
      // Optimistic add
      setDirectives((prev) => [...prev, { id: Date.now().toString(), directive_text: text, created_at: new Date().toISOString(), is_active: true }]);
    }
  };

  const handleRemoveDirective = async (id: string) => {
    setDirectives((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/skyler/directives?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const handleFetchTranscript = async (meetingId: string) => {
    const res = await fetch(`/api/skyler/meetings/${meetingId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.transcript ?? [];
  };

  const handleTagForChat = () => {
    if (!selectedRecord) return;
    handleTagLead(selectedRecord.id);
  };

  // ── Conversation management ──────────────────────────────────────

  const handleNewChat = () => {
    chat.clearChat();
    setChatOpen(true);
  };

  const handleStarConversation = async (id: string, starred: boolean) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, is_starred: starred } : c));
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_starred: starred }),
    });
  };

  const handleRenameConversation = async (id: string, title: string) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, custom_title: title || undefined } : c));
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_title: title }),
    });
  };

  const handleDeleteConversation = async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (chat.activeConversationId === id) {
      chat.clearChat();
    }
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  };

  // ── Chat ────────────────────────────────────────────────────────

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chat.isStreaming) return;

    setChatInput("");
    await chat.sendMessage({
      message: trimmed,
      taggedLead: taggedLead ? { id: taggedLead.id, name: taggedLead.name } : null,
      pipelineContext: taggedLead
        ? {
            source: "pipeline",
            pipeline_id: taggedLead.id,
            contact_name: taggedLead.name,
            company_name: taggedLead.company,
            contact_email: taggedLead.email,
            stage: taggedLead.stage,
          }
        : null,
      pageContext: getPageContext(),
    });
  };

  const handleSelectConversation = async (convId: string) => {
    try {
      const res = await fetch(`/api/skyler/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msgs: ChatMessage[] = (data.messages ?? []).map(
          (m: { id: string; role: string; content: string }, i: number) => ({
            id: m.id ?? `msg-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
          })
        );
        chat.switchConversation(convId, msgs);
      }
    } catch {
      // Silently ignore
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex h-full" style={{ background: "var(--sk-bg)" }}>
      {/* Left Sidebar */}
      <SkylerSidebar
        collapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        conversations={conversations}
        activeConversationId={chat.activeConversationId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onStarConversation={handleStarConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Main workspace area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar — always visible on all tabs */}
        <div className="h-[60px] flex items-center justify-between px-6 flex-shrink-0 border-b border-[#2A2D35]/40 bg-[#1B1B1B]">
          <div className="flex items-center gap-4">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="text-[#8B8F97] hover:text-white transition-colors"
                aria-label="Show sidebar"
              >
                <PanelLeftOpen className="w-5 h-5" />
              </button>
            )}
            <Image
              src="/cleverbrain-chat-icons/cleverfolks-logo.png"
              alt="Cleverfolks"
              width={120}
              height={24}
              className="brightness-0 invert"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Bell className="w-5 h-5 text-[#8B8F97]" />
            </div>
            <Image
              src="/cleverbrain-chat-icons/organization-dp.png"
              alt="User"
              width={32}
              height={32}
              className="rounded-full"
            />
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <div className="text-right">
                  <p className="text-white text-sm font-medium leading-tight">{userName || "User"}</p>
                  <p className="text-[#8B8F97] text-xs leading-tight">{companyName || "Company"}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-[#8B8F97]" />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-[#1E1E1E] border border-[#2A2D35] rounded-xl py-1 z-50 shadow-xl">
                    <Link
                      href="/settings"
                      className="block px-4 py-2 text-sm text-[#8B8F97] hover:text-white hover:bg-white/5 transition-colors"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => void signOut()}
                      className="w-full text-left px-4 py-2 text-sm text-[#F87171] hover:bg-white/5 transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Metrics bar — only on Sales Closer tab */}
        {activeTab === "sales-closer" && (
          <MetricsBar
            metrics={performanceMetrics}
            salesCloserEnabled={salesCloserEnabled}
            onToggle={handleToggleSalesCloser}
          />
        )}

        {/* Content area — switches based on active sidebar tab */}
        {activeTab === "sales-closer" && (
          <div className="flex flex-1 overflow-hidden">
            <LeadListPanel
              records={pipelineRecords}
              loading={pipelineLoading}
              selectedId={selectedLeadId}
              phaseFilter={phaseFilter}
              searchQuery={searchQuery}
              onSelectLead={handleSelectLead}
              onTagLead={handleTagLead}
              onPhaseFilterChange={setPhaseFilter}
              onSearchChange={setSearchQuery}
            />

            <LeadDetailPanel
              record={selectedRecord}
              loading={pipelineLoading}
              alerts={alerts}
              pipelineEvents={pipelineEvents}
              directives={directives}
              directivesLoading={directivesLoading}
              upcomingMeetings={upcomingMeetings}
              pastMeetings={pastMeetings}
              meetingsLoading={meetingsLoading}
              onApprove={handleApproveDraft}
              onReject={handleRejectDraft}
              onRetry={handleRetryDraft}
              onDismissAlert={handleDismissAlert}
              onReplyToRequest={handleReplyToRequest}
              onDismissRequest={handleDismissRequest}
              onAddDirective={handleAddDirective}
              onRemoveDirective={handleRemoveDirective}
              onFetchTranscript={handleFetchTranscript}
              onTagForChat={handleTagForChat}
            />

            <ChatPanel
              open={chatOpen}
              onToggle={() => setChatOpen((prev) => !prev)}
              messages={chat.messages}
              conversations={conversations}
              streamingContent={chat.streamingContent}
              streamingActivities={chat.streamingActivities}
              activitiesDone={chat.activitiesDone}
              inputValue={chatInput}
              onInputChange={setChatInput}
              onSend={handleSendMessage}
              taggedLead={taggedLead}
              onClearTag={() => setTaggedLead(null)}
              isStreaming={chat.isStreaming}
              onSelectConversation={handleSelectConversation}
            />
          </div>
        )}

        {activeTab === "lead-qualification" && (
          <div className="flex-1 overflow-y-auto">
            <LeadQualificationView workspaceId={workspaceId} />
          </div>
        )}

        {activeTab === "workflows-settings" && (
          <div className="flex-1 overflow-y-auto">
            <WorkflowSettings workspaceId={workspaceId} />
          </div>
        )}
      </div>

      {/* Right Icon Bar */}
      <RightIconBar />
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PanelLeftOpen } from "lucide-react";
import { SkylerSidebar } from "./skyler-sidebar";
import { MetricsBar } from "./metrics-bar";
import { LeadListPanel } from "./lead-list/lead-list-panel";
import { LeadDetailPanel } from "./lead-detail/lead-detail-panel";
import { ChatPanel } from "./chat/chat-panel";
import { RightIconBar } from "./right-icon-bar";
import type {
  PipelineRecord,
  PerformanceMetrics,
  ChatMessage,
  ConversationItem,
  TaggedLead,
  AlertItem,
  DirectiveItem,
  CalendarEvent,
  MeetingRecord,
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

  // ── Sidebar state ───────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Chat state ──────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [taggedLead, setTaggedLead] = useState<TaggedLead | null>(null);

  // Ref to track activeConversationId inside SSE handler
  const activeConvIdRef = useRef(activeConversationId);
  activeConvIdRef.current = activeConversationId;

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

  const fetchConversations = useCallback(async () => {
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

  // On mount
  useEffect(() => {
    fetchPipelineData();
    fetchConversations();
  }, [fetchPipelineData, fetchConversations]);

  // ── Lead selection side effects ─────────────────────────────────

  const selectedRecord = pipelineRecords.find((r) => r.id === selectedLeadId) ?? null;

  useEffect(() => {
    if (!selectedLeadId) {
      setAlerts([]);
      setDirectives([]);
      setUpcomingMeetings([]);
      setPastMeetings([]);
      return;
    }

    // Fetch directives
    setDirectivesLoading(true);
    fetch(`/api/skyler/directives?pipelineId=${selectedLeadId}`)
      .then((res) => (res.ok ? res.json() : { directives: [] }))
      .then((data) => setDirectives(data.directives ?? []))
      .finally(() => setDirectivesLoading(false));

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

  const handleApproveDraft = async (actionId: string) => {
    if (!selectedLeadId) return;
    try {
      const res = await fetch(`/api/skyler/sales-pipeline/${selectedLeadId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId }),
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
    setActiveConversationId(null);
    setChatMessages([]);
    setStreamingContent("");
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
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setChatMessages([]);
    }
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  };

  // ── Chat ────────────────────────────────────────────────────────

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      taggedLead: taggedLead ? { id: taggedLead.id, name: taggedLead.name } : null,
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsStreaming(true);
    setStreamingContent("");

    let currentConversationId = activeConvIdRef.current;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chatBody: Record<string, any> = {
        message: trimmed,
        workspaceId,
        conversationId: currentConversationId ?? undefined,
      };

      if (taggedLead) {
        chatBody.pipelineContext = {
          source: "pipeline",
          pipeline_id: taggedLead.id,
          contact_name: taggedLead.name,
          company_name: taggedLead.company,
          contact_email: taggedLead.email,
          stage: taggedLead.stage,
        };
      }

      const res = await fetch("/api/skyler/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody),
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to connect to Skyler");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "text") {
              accumulatedText += event.text;
              setStreamingContent(accumulatedText);
            } else if (event.type === "metadata") {
              if (event.conversationId) {
                currentConversationId = event.conversationId;
                if (!activeConvIdRef.current) {
                  setActiveConversationId(event.conversationId);
                }
              }
            } else if (event.type === "done") {
              setChatMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  content: accumulatedText,
                },
              ]);
              setStreamingContent("");
              fetchConversations();
              // Refresh pipeline in case chat triggered any actions
              fetchPipelineData();
            } else if (event.type === "error") {
              setChatMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  content: "Something went wrong. Please try again.",
                },
              ]);
              setStreamingContent("");
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "Failed to connect to Skyler. Please try again.",
        },
      ]);
      setStreamingContent("");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSelectConversation = async (convId: string) => {
    setActiveConversationId(convId);
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
        setChatMessages(msgs);
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
        activeConversationId={activeConversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onStarConversation={handleStarConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Main workspace area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top area: expand sidebar button (when collapsed) + metrics */}
        <div className="flex items-center" style={{ background: "var(--sk-surface)", borderBottom: "1px solid var(--sk-border)" }}>
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="flex-shrink-0 transition-colors"
              style={{ padding: "14px 12px 14px 18px", color: "var(--sk-t3)" }}
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1">
            <MetricsBar
              metrics={performanceMetrics}
              salesCloserEnabled={salesCloserEnabled}
              onToggle={handleToggleSalesCloser}
            />
          </div>
        </div>

        {/* Three-panel content */}
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
            directives={directives}
            directivesLoading={directivesLoading}
            upcomingMeetings={upcomingMeetings}
            pastMeetings={pastMeetings}
            meetingsLoading={meetingsLoading}
            onApprove={handleApproveDraft}
            onReject={handleRejectDraft}
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
            messages={chatMessages}
            conversations={conversations}
            streamingContent={streamingContent}
            inputValue={chatInput}
            onInputChange={setChatInput}
            onSend={handleSendMessage}
            taggedLead={taggedLead}
            onClearTag={() => setTaggedLead(null)}
            isStreaming={isStreaming}
            onSelectConversation={handleSelectConversation}
          />
        </div>
      </div>

      {/* Right Icon Bar */}
      <RightIconBar />
    </div>
  );
}

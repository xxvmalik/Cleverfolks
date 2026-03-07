"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Mic,
  Search,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  Users,
  Target,
  Settings,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { ActionApproval } from "@/components/skyler/action-approval";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkflowTab = "lead-qualification" | "prospect-engagement" | "sales-closer" | "workflows-settings";

type LeadPriority = "High" | "Medium" | "Low";

type Lead = {
  id: string;
  company: string;
  priority: LeadPriority;
  potential: string;
  detail: string;
  stage?: string;
  probability?: number;
};

type LeadFilter = "all" | "hot" | "nurture" | "disqualified";

type DashboardData = {
  stats: {
    qualificationRate: number;
    hotLeads: number;
    nurtureQueue: number;
    disqualified: number;
  };
  leads: Lead[];
  connectedIntegrations: { id: string; provider: string }[];
  salesCloserEnabled: boolean;
};

type IntegrationLogo = {
  provider: string;
  logoUrl: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ConversationItem = {
  id: string;
  title: string;
  updated_at: string;
};

// ── Stats Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 bg-[#212121] border border-[#2A2D35]/40 rounded-xl px-5 py-4">
      <p className="text-[#8B8F97] text-xs mb-1">{label}</p>
      <p className="text-white font-bold text-2xl">{value}</p>
    </div>
  );
}

// ── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-[52px] h-[28px] rounded-full relative transition-colors flex-shrink-0",
        enabled ? "bg-[#545454]" : "bg-[#545454]"
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

// ── Lead Card ────────────────────────────────────────────────────────────────

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

// ── Right Icon Bar ───────────────────────────────────────────────────────────

function SkylerRightIconBar() {
  return (
    <div className="w-[76px] bg-[#1B1B1B] border-l border-[#2A2D35]/60 flex flex-col items-center justify-center flex-shrink-0">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#2A2D35]/60 px-3 py-5" style={{ background: "#1F1F1FCC" }}>
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png" alt="CleverBrain" width={36} height={36} />
        </Link>
        <Link href="/skyler" title="Skyler" className="opacity-100 ring-2 ring-[#F2903D]/40 rounded-lg transition-opacity">
          <Image src="/cleverbrain-chat-icons/skyler-icon.png" alt="Skyler" width={36} height={36} className="rounded-full" />
        </Link>
        <Link href="/cleverbrain" title="Connectors" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/conectors-icon.png" alt="Connectors" width={34} height={34} />
        </Link>
        <Link href="/cleverbrain" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/hire-ai-employee-icon.png" alt="AI Employees" width={34} height={34} />
        </Link>
        <Link href="/settings" title="Organization" className="hover:opacity-80 transition-opacity">
          <Image src="/cleverbrain-chat-icons/organization-icon.png" alt="Organization" width={36} height={36} />
        </Link>
      </div>
    </div>
  );
}

// ── Workflow Nav Items ─────────────────────────────────────────────────────────

const WORKFLOW_TABS: { id: WorkflowTab; label: string; icon: typeof Zap }[] = [
  { id: "lead-qualification", label: "Lead Qualification", icon: Zap },
  { id: "prospect-engagement", label: "Prospect Engagement", icon: Users },
  { id: "sales-closer", label: "Sales Closer", icon: Target },
  { id: "workflows-settings", label: "Workflows Settings", icon: Settings },
];

// ── Action tag parser ─────────────────────────────────────────────────────────

const ACTION_PENDING_RE = /\[ACTION_PENDING:([0-9a-f-]+)\]\s*/gi;
const ACTION_EXECUTED_RE = /\[ACTION_EXECUTED\]\s*/gi;

function parseActionTags(content: string): { cleanContent: string; pendingActions: Array<{ id: string; description: string }> } {
  const pendingActions: Array<{ id: string; description: string }> = [];
  let clean = content;

  // Extract pending action IDs and descriptions
  let match: RegExpExecArray | null;
  ACTION_PENDING_RE.lastIndex = 0;
  while ((match = ACTION_PENDING_RE.exec(content)) !== null) {
    const actionId = match[1];
    // The description follows the tag until the next newline
    const afterTag = content.slice(match.index + match[0].length);
    const descLine = afterTag.split("\n")[0]?.trim() ?? "";
    pendingActions.push({ id: actionId, description: descLine });
  }

  // Strip tags from display text
  clean = clean.replace(ACTION_PENDING_RE, "");
  clean = clean.replace(ACTION_EXECUTED_RE, "");
  return { cleanContent: clean.trim(), pendingActions };
}

const QUICK_ACTIONS = [
  "How's our pipeline looking?",
  "Which deals are closing soon?",
  "Who should I follow up with?",
  "Prep me for my next call",
];

// ── Main Component ───────────────────────────────────────────────────────────

export function SkylerClient({
  workspaceId,
  userName,
  companyName,
}: {
  workspaceId: string;
  userName?: string;
  companyName?: string;
}) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkflowTab>("lead-qualification");
  const [leadQualEnabled, setLeadQualEnabled] = useState(true);
  const [salesCloserEnabled, setSalesCloserEnabled] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [inputValue, setInputValue] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Dashboard data
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [integrationLogos, setIntegrationLogos] = useState<IntegrationLogo[]>([]);
  const [loading, setLoading] = useState(true);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");

  // Fetch dashboard data
  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, logosRes] = await Promise.all([
        fetch(`/api/skyler/dashboard?workspaceId=${workspaceId}`),
        fetch(`/api/integration-logos?workspaceId=${workspaceId}`),
      ]);
      if (dashRes.ok) {
        const data = await dashRes.json();
        setDashData(data);
        setSalesCloserEnabled(data.salesCloserEnabled);
      }
      if (logosRes.ok) {
        const data = await logosRes.json();
        setIntegrationLogos(data.logos ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Fetch conversation history
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/skyler/conversations?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations ?? []);
      }
    } catch {
      // Silently ignore — conversations API may not exist yet
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchDashboard();
    fetchConversations();
  }, [fetchDashboard, fetchConversations]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  // Toggle sales closer
  async function handleSalesCloserToggle() {
    const newValue = !salesCloserEnabled;
    setSalesCloserEnabled(newValue);
    await fetch("/api/skyler/dashboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, salesCloserEnabled: newValue }),
    });
  }

  // Send message to Skyler
  async function handleSendMessage(messageText?: string) {
    const trimmed = (messageText ?? inputValue).trim();
    if (!trimmed || isStreaming) return;

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Add user message to chat
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setActivityLabel("Thinking...");
    setStreamingContent("");

    try {
      const res = await fetch("/api/skyler/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          workspaceId,
          conversationId: activeConversationId ?? undefined,
        }),
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

            if (event.type === "activity") {
              setActivityLabel(event.action);
            } else if (event.type === "text") {
              accumulatedText += event.text;
              setStreamingContent(accumulatedText);
              setActivityLabel(null);
            } else if (event.type === "metadata") {
              if (event.conversationId && !activeConversationId) {
                setActiveConversationId(event.conversationId);
              }
            } else if (event.type === "done") {
              // Finalize the assistant message
              const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: accumulatedText,
              };
              setChatMessages((prev) => [...prev, assistantMsg]);
              setStreamingContent("");
              setActivityLabel(null);
              // Refresh conversation list
              fetchConversations();
            } else if (event.type === "error") {
              const errorMsg: ChatMessage = {
                id: `error-${Date.now()}`,
                role: "assistant",
                content: `Sorry, something went wrong: ${event.error}`,
              };
              setChatMessages((prev) => [...prev, errorMsg]);
              setStreamingContent("");
              setActivityLabel(null);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Connection error: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      setActivityLabel(null);
      setStreamingContent("");
    }
  }

  // New chat
  function handleNewChat() {
    setActiveConversationId(null);
    setChatMessages([]);
    setStreamingContent("");
    setActivityLabel(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  // Load conversation
  async function loadConversation(convId: string) {
    setActiveConversationId(convId);
    setChatMessages([]);
    setStreamingContent("");
    try {
      const res = await fetch(`/api/skyler/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setChatMessages(
          (data.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      }
    } catch {
      // Silently ignore
    }
  }

  const leads = dashData?.leads ?? [];
  const stats = dashData?.stats ?? { qualificationRate: 0, hotLeads: 0, nurtureQueue: 0, disqualified: 0 };

  const filteredLeads = leads.filter((lead) => {
    if (leadFilter === "all") return true;
    if (leadFilter === "hot") return lead.priority === "High";
    if (leadFilter === "nurture") return lead.priority === "Medium" || lead.priority === "Low";
    if (leadFilter === "disqualified") return false;
    return true;
  });

  function handlePrompt(company: string) {
    setInputValue(`Tell me about the ${company} deal`);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }

  const hasChatContent = chatMessages.length > 0 || streamingContent;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#1B1B1B]">
      {/* ── Left Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden bg-[#1B1B1B]",
          sidebarCollapsed ? "w-0" : "w-[240px]"
        )}
      >
        <div className="flex items-center justify-end px-3 pt-3 pb-1">
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="text-[#8B8F97] hover:text-white transition-colors"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center px-4 pt-2 pb-4">
          <div className="w-[140px] h-[140px] rounded-full overflow-hidden mb-3">
            <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={140} height={140} className="object-cover aspect-square" />
          </div>
          <h2 className="text-white font-bold text-lg">Skyler</h2>
          <p className="text-[#8B8F97] text-sm mt-0.5">Sales Representative</p>

          <button
            onClick={handleNewChat}
            className="mt-4 w-full h-[38px] rounded-full flex items-center justify-center gap-2 text-white text-sm font-medium bg-[#2A2A2A] border border-[#3A3A3A] hover:bg-[#353535] transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Start new chat
          </button>
        </div>

        <nav className="px-2 space-y-0.5">
          {WORKFLOW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  isActive
                    ? "text-white border-l-2 border-[#F2903D] bg-white/5"
                    : "text-[#8B8F97] hover:text-white hover:bg-white/5 border-l-2 border-transparent"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* History */}
        <div className="flex-1 flex flex-col overflow-hidden mt-4">
          <button
            onClick={() => setHistoryCollapsed((v) => !v)}
            className="flex items-center justify-between px-4 py-2.5 text-white text-sm font-medium hover:bg-white/5 transition-colors"
          >
            <span>History</span>
            {historyCollapsed ? (
              <ChevronDown className="w-4 h-4 text-[#8B8F97]" />
            ) : (
              <ChevronUp className="w-4 h-4 text-[#8B8F97]" />
            )}
          </button>
          {!historyCollapsed && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {conversations.length === 0 ? (
                <p className="px-3 py-4 text-xs text-[#555A63] text-center">
                  No conversations yet
                </p>
              ) : (
                <div className="space-y-0.5">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => loadConversation(conv.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate",
                        conv.id === activeConversationId
                          ? "text-white bg-white/10"
                          : "text-[#8B8F97] hover:text-white hover:bg-white/5"
                      )}
                    >
                      {conv.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
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
                      onClick={() => void handleSignOut()}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Lead Qualification Header */}
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

          {/* Section 2: Stats Cards */}
          <div className="px-6 py-4 flex gap-4">
            <StatCard label="Qualification Rate" value={loading ? "..." : `${stats.qualificationRate}%`} />
            <StatCard label="Hot Leads" value={loading ? "..." : String(stats.hotLeads)} />
            <StatCard label="Nurture Queue" value={loading ? "..." : String(stats.nurtureQueue)} />
            <StatCard label="Disqualified" value={loading ? "..." : String(stats.disqualified)} />
          </div>

          {/* Section 3: Sales Closer Permission Bar */}
          <div className="mx-6 mb-4 bg-[#1F1F1F] border border-[#2A2D35]/40 rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <span className="text-white font-semibold text-sm">Sales Closer</span>
              <span className="text-[#8B8F97] text-sm ml-2">
                Skyler takes over the conversation handling questions, addressing objections, and booking demos.
              </span>
            </div>
            <ToggleSwitch enabled={salesCloserEnabled} onToggle={handleSalesCloserToggle} />
          </div>

          {/* Section 4: Two-column layout */}
          <div className="flex-1 flex px-6 pb-6 gap-5 min-h-0" style={{ height: "calc(100vh - 340px)" }}>
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
                      onPrompt={() => handlePrompt(lead.company)}
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
              </div>

              {/* Chat content */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {!hasChatContent ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Image
                        src="/skyler-icons/skyler-avatar.png"
                        alt="Skyler"
                        width={64}
                        height={64}
                        className="rounded-full mx-auto mb-4 opacity-40 object-cover aspect-square"
                      />
                      <p className="text-[#555A63] text-sm">
                        Connect with Skyler to start managing your sales pipeline.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {chatMessages.map((msg) => {
                      const { cleanContent, pendingActions } =
                        msg.role === "assistant"
                          ? parseActionTags(msg.content)
                          : { cleanContent: msg.content, pendingActions: [] };

                      return (
                        <div key={msg.id}>
                          <div className={cn("flex gap-3 items-start", msg.role === "user" ? "justify-end" : "")}>
                            {msg.role === "assistant" && (
                              <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                                <Image
                                  src="/skyler-icons/skyler-avatar.png"
                                  alt="Skyler"
                                  width={28}
                                  height={28}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div
                              className={cn(
                                "rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%]",
                                msg.role === "user"
                                  ? "bg-[#F2903D]/20 text-white"
                                  : "bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]"
                              )}
                            >
                              {msg.role === "assistant" ? (
                                <MarkdownRenderer content={cleanContent} />
                              ) : (
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                              )}
                            </div>
                          </div>
                          {pendingActions.length > 0 && (
                            <div className="ml-10 mt-2 space-y-2">
                              {pendingActions.map((pa) => (
                                <ActionApproval
                                  key={pa.id}
                                  actionId={pa.id}
                                  description={pa.description}
                                  workspaceId={workspaceId}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Streaming response */}
                    {(streamingContent || activityLabel) && (
                      <div className="flex gap-3 items-start">
                        <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                          <Image
                            src="/skyler-icons/skyler-avatar.png"
                            alt="Skyler"
                            width={28}
                            height={28}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]">
                          {streamingContent ? (
                            <MarkdownRenderer content={streamingContent} />
                          ) : (
                            <div className="flex items-center gap-2 text-[#8B8F97]">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span className="text-xs">{activityLabel}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Quick actions */}
              {!hasChatContent && (
                <div className="px-4 pb-2">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(action)}
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
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      resizeTextarea(e.target);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Skyler about your pipeline..."
                    rows={1}
                    disabled={isStreaming}
                    className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed disabled:opacity-50"
                    style={{ maxHeight: "160px", overflowY: "auto" }}
                  />
                  <button
                    type="button"
                    onClick={() => { void handleSendMessage(); }}
                    className="flex-shrink-0 pb-0.5 cursor-pointer"
                    aria-label="Send message"
                  >
                    <Image
                      src="/cleverbrain-chat-icons/send-prompt-icon.png"
                      alt="Send"
                      width={24}
                      height={24}
                      className={cn("transition-opacity pointer-events-none", inputValue.trim() && !isStreaming ? "opacity-100" : "opacity-40")}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Icon Bar ────────────────────────────────────────────── */}
      <SkylerRightIconBar />
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
  Mic,
  UserCheck,
  X,
  Edit2,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import {
  getConversationsAction,
  getMessagesAction,
  type ConversationRow,
  type MessageRow,
} from "@/app/actions/chat";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceInfo = {
  source_type: string;
  title: string;
  channel?: string;
  user_name?: string;
  timestamp?: string;
  similarity?: number;
};

type ActivityItem = {
  action: string;
  complete: boolean;
};

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceInfo[] | null;
  created_at: string;
  activities?: ActivityItem[];
};

type StreamingState = {
  activities: ActivityItem[];
  content: string;
  sources: SourceInfo[];
  conversationId: string | null;
  messageId: string | null;
  textStarted: boolean;
  isComplete: boolean;
};

type SSEEvent =
  | { type: "activity"; action: string }
  | { type: "text"; text: string }
  | { type: "sources"; sources: SourceInfo[] }
  | { type: "metadata"; conversationId: string; messageId: string }
  | { type: "done" }
  | { type: "error"; error: string };

type TeamMemberForReview = {
  name: string;
  detected_role: string;
  confidence: string;
};

// ── Suggestion cards ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What were the key topics discussed in Slack this week?",
  "Summarise recent team conversations",
  "What decisions were made recently?",
  "Are there any action items from recent discussions?",
];

// ── Markdown renderer ─────────────────────────────────────────────────────────

function applyInline(s: string): string {
  return s
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-[#0D0F12] text-[#3A89FF] rounded px-1 py-0.5 font-mono text-[0.85em]">$1</code>'
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const parts: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList: "ul" | "ol" | null = null;

  const flushList = () => {
    if (inList) {
      parts.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        const escaped = codeLines
          .join("\n")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        parts.push(
          `<pre class="bg-[#0D0F12] rounded-lg p-3 my-3 overflow-x-auto"><code class="text-sm font-mono text-[#E0E0E0] whitespace-pre">${escaped}</code></pre>`
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const isUl = /^[-*] /.test(line);
    const isOl = /^\d+\. /.test(line);

    if (!isUl && inList === "ul") flushList();
    if (!isOl && inList === "ol") flushList();

    if (/^### /.test(line)) {
      parts.push(
        `<h3 class="text-white font-semibold text-base mt-4 mb-1">${applyInline(line.slice(4))}</h3>`
      );
    } else if (/^## /.test(line)) {
      parts.push(
        `<h2 class="text-white font-semibold text-lg mt-4 mb-2">${applyInline(line.slice(3))}</h2>`
      );
    } else if (/^# /.test(line)) {
      parts.push(
        `<h1 class="text-white font-bold text-xl mt-4 mb-2">${applyInline(line.slice(2))}</h1>`
      );
    } else if (isUl) {
      if (inList !== "ul") {
        parts.push('<ul class="list-disc list-outside ml-5 space-y-1 my-2">');
        inList = "ul";
      }
      parts.push(`<li class="text-[#E0E0E0]">${applyInline(line.slice(2))}</li>`);
    } else if (isOl) {
      if (inList !== "ol") {
        parts.push('<ol class="list-decimal list-outside ml-5 space-y-1 my-2">');
        inList = "ol";
      }
      parts.push(`<li class="text-[#E0E0E0]">${applyInline(line.replace(/^\d+\. /, ""))}</li>`);
    } else if (line.trim() === "") {
      parts.push("<br>");
    } else {
      parts.push(`<p class="mb-1 leading-relaxed">${applyInline(line)}</p>`);
    }
  }

  flushList();
  if (inCodeBlock && codeLines.length > 0) {
    const escaped = codeLines
      .join("\n")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    parts.push(
      `<pre class="bg-[#0D0F12] rounded-lg p-3 my-3 overflow-x-auto"><code class="text-sm font-mono text-[#E0E0E0] whitespace-pre">${escaped}</code></pre>`
    );
  }

  return parts.join("");
}

// ── Time grouping ─────────────────────────────────────────────────────────────

function groupConversations(convs: ConversationRow[]) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return {
    today: convs.filter((c) => new Date(c.updated_at) >= todayStart),
    yesterday: convs.filter(
      (c) => new Date(c.updated_at) >= yesterdayStart && new Date(c.updated_at) < todayStart
    ),
    previous7Days: convs.filter(
      (c) => new Date(c.updated_at) >= sevenDaysAgo && new Date(c.updated_at) < yesterdayStart
    ),
    older: convs.filter((c) => new Date(c.updated_at) < sevenDaysAgo),
  };
}

// ── Source pills ──────────────────────────────────────────────────────────────

function SourcePills({ sources }: { sources: SourceInfo[] }) {
  if (!sources.length) return null;
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    const label = s.channel ?? s.title ?? s.source_type;
    const key = `${s.source_type}:${label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const MAX_PILLS = 6;
  const displayed = unique.slice(0, MAX_PILLS);
  const remaining = unique.length - MAX_PILLS;

  return (
    <div className="mt-3 bg-[#1E1E1E] rounded-xl px-4 py-3">
      <p className="text-[#8B8F97] text-xs mb-2 flex items-center gap-1.5">
        <span className="text-[#3A89FF] font-bold">#</span>
        Sources: {displayed.map((s) => s.channel ?? s.title ?? s.source_type).join(", ")}
        {remaining > 0 && ` • +${remaining} more`}
        {" • "}
        {sources.length} messages
      </p>
    </div>
  );
}

// ── Activity row ──────────────────────────────────────────────────────────────

function ActivityRow({ action, complete }: { action: string; complete: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {complete ? (
        <Check className="w-4 h-4 text-[#4ADE80] flex-shrink-0" />
      ) : (
        <Loader2 className="w-4 h-4 text-[#8B8F97] animate-spin flex-shrink-0" />
      )}
      <span className="text-[#8B8F97] text-sm">{action}</span>
    </div>
  );
}

// ── Conversation sidebar item ─────────────────────────────────────────────────

function ConvItem({
  conv,
  isActive,
  onClick,
}: {
  conv: ConversationRow;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors duration-150",
        isActive
          ? "bg-white/10 text-white"
          : "text-[#8B8F97] hover:bg-white/5 hover:text-white"
      )}
    >
      {conv.title || "New conversation"}
    </button>
  );
}

// ── Profile Review Card ───────────────────────────────────────────────────────

function ProfileReviewCard({
  workspaceId,
  members,
  onConfirm,
  onDismiss,
}: {
  workspaceId: string;
  members: TeamMemberForReview[];
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => [m.name, m.detected_role]))
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  const uncertainMembers = members.filter(
    (m) => m.confidence === "low" || m.confidence === "medium"
  );

  async function handleConfirm() {
    setIsConfirming(true);
    try {
      const corrections: Record<string, string> = {};
      for (const m of members) {
        if (roleEdits[m.name] && roleEdits[m.name] !== m.detected_role) {
          corrections[m.name] = roleEdits[m.name];
        }
      }
      await fetch("/api/knowledge-profile/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, corrections }),
      });
      onConfirm();
    } catch {
      onConfirm();
    } finally {
      setIsConfirming(false);
    }
  }

  if (uncertainMembers.length === 0) return null;

  return (
    <div className="w-full bg-[#1E1E1E] border border-[#3A89FF]/30 rounded-2xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#3A89FF]/15 flex items-center justify-center flex-shrink-0">
            <UserCheck className="w-4 h-4 text-[#3A89FF]" />
          </div>
          <div>
            <p className="text-white text-sm font-medium">Review team roles</p>
            <p className="text-[#8B8F97] text-xs mt-0.5">
              CleverBrain auto-detected these roles. Confirm or correct them for better answers.
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-[#555A63] hover:text-[#8B8F97] transition-colors flex-shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 mb-3">
        {uncertainMembers.map((m) => (
          <div key={m.name} className="flex items-center gap-2">
            <span className="text-[#E0E0E0] text-sm w-28 flex-shrink-0 truncate">
              {m.name}
            </span>
            {editingName === m.name ? (
              <input
                autoFocus
                value={roleEdits[m.name] ?? ""}
                onChange={(e) =>
                  setRoleEdits((prev) => ({ ...prev, [m.name]: e.target.value }))
                }
                onBlur={() => setEditingName(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setEditingName(null);
                }}
                className="flex-1 bg-[#151515] border border-[#3A89FF]/50 rounded-lg px-2 py-1 text-sm text-white outline-none"
                placeholder="Enter role…"
              />
            ) : (
              <button
                onClick={() => setEditingName(m.name)}
                className="flex-1 text-left flex items-center gap-1.5 group"
              >
                <span className="text-[#8B8F97] text-sm truncate group-hover:text-white transition-colors">
                  {roleEdits[m.name] || "Unknown role"}
                </span>
                <Edit2 className="w-3 h-3 text-[#555A63] group-hover:text-[#3A89FF] transition-colors flex-shrink-0" />
              </button>
            )}
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0",
                m.confidence === "low"
                  ? "bg-[#F87171]/10 text-[#F87171]"
                  : "bg-[#FB923C]/10 text-[#FB923C]"
              )}
            >
              {m.confidence}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleConfirm()}
          disabled={isConfirming}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3A89FF] hover:bg-[#2d7aff] disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {isConfirming ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Check className="w-3 h-3" />
          )}
          {isConfirming ? "Saving…" : "Confirm roles"}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-[#8B8F97] hover:text-white text-xs rounded-lg transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ── Right Icon Bar ────────────────────────────────────────────────────────────

function RightIconBar() {
  return (
    <div className="w-[76px] bg-[#151515] border-l border-[#2A2D35]/60 flex flex-col items-center justify-center flex-shrink-0">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#2A2D35]/60 px-3 py-5" style={{ background: "#1F1F1FCC" }}>
        {/* CleverBrain chat */}
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image
            src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png"
            alt="CleverBrain"
            width={36}
            height={36}
          />
        </Link>

        {/* Skyler */}
        <Link href="/skyler" title="Skyler" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image
            src="/cleverbrain-chat-icons/skyler-icon.png"
            alt="Skyler"
            width={36}
            height={36}
            className="rounded-full"
          />
        </Link>

        {/* Connectors */}
        <Link href="/integrations" title="Connectors" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image
            src="/cleverbrain-chat-icons/conectors-icon.png"
            alt="Connectors"
            width={34}
            height={34}
          />
        </Link>

        {/* AI Employee */}
        <Link href="/marketplace" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image
            src="/cleverbrain-chat-icons/hire-ai-employee-icon.png"
            alt="AI Employees"
            width={34}
            height={34}
          />
        </Link>

        {/* Organization */}
        <Link href="/settings" title="Organization" className="hover:opacity-80 transition-opacity">
          <Image
            src="/cleverbrain-chat-icons/organization-icon.png"
            alt="Organization"
            width={36}
            height={36}
          />
        </Link>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CleverBrainClient({
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
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const [reviewMembers, setReviewMembers] = useState<TeamMemberForReview[] | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreamingRef = useRef(false);

  // ── Load conversations ──────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    const { conversations: data } = await getConversationsAction(workspaceId);
    setConversations(data);
  }, [workspaceId]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  // ── Check profile review ────────────────────────────────────────────────
  useEffect(() => {
    async function checkProfileReview() {
      try {
        const res = await fetch(
          `/api/knowledge-profile/confirm?workspaceId=${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          confirmed: boolean;
          team_members: TeamMemberForReview[];
        };
        if (data.status === "pending_review" && !data.confirmed) {
          const uncertain = data.team_members.filter(
            (m) => m.confidence === "low" || m.confidence === "medium"
          );
          if (uncertain.length > 0) setReviewMembers(uncertain);
        }
      } catch {
        /* silently ignore */
      }
    }
    void checkProfileReview();
  }, [workspaceId]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingState?.content, streamingState?.activities?.length]);

  // ── Load conversation messages ──────────────────────────────────────────
  const loadConversation = useCallback(async (convId: string) => {
    setActiveConversationId(convId);
    setStreamingState(null);
    const { messages: rows } = await getMessagesAction(convId);
    setMessages(
      rows.map((r: MessageRow) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        sources: Array.isArray(r.sources) ? (r.sources as SourceInfo[]) : null,
        created_at: r.created_at,
      }))
    );
  }, []);

  // ── New chat ────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setStreamingState(null);
    setInputValue("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // ── Textarea auto-resize ────────────────────────────────────────────────
  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  // ── Send message + SSE stream ───────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreamingRef.current) return;

      isStreamingRef.current = true;
      setIsStreaming(true);
      setInputValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      const tempId = `temp-${Date.now()}`;
      const userMsg: UIMessage = {
        id: tempId,
        role: "user",
        content: trimmed,
        sources: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const initState: StreamingState = {
        activities: [],
        content: "",
        sources: [],
        conversationId: activeConversationId,
        messageId: null,
        textStarted: false,
        isComplete: false,
      };
      setStreamingState(initState);

      let finalConversationId = activeConversationId;
      let localStreaming: StreamingState = initState;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            workspaceId,
            conversationId: activeConversationId ?? undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || `HTTP ${res.status}`);
        }
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event: SSEEvent;
            try {
              event = JSON.parse(line.slice(6)) as SSEEvent;
            } catch {
              continue;
            }

            if (event.type === "activity") {
              const { action } = event;
              const activities = localStreaming.activities.map((a, i, arr) =>
                i === arr.length - 1 ? { ...a, complete: true } : a
              );
              localStreaming = { ...localStreaming, activities: [...activities, { action, complete: false }] };
              setStreamingState(localStreaming);
            } else if (event.type === "text") {
              const { text: chunk } = event;
              const activities =
                !localStreaming.textStarted && localStreaming.activities.length > 0
                  ? localStreaming.activities.map((a, i, arr) =>
                      i === arr.length - 1 ? { ...a, complete: true } : a
                    )
                  : localStreaming.activities;
              localStreaming = {
                ...localStreaming,
                content: localStreaming.content + chunk,
                textStarted: true,
                activities,
              };
              setStreamingState(localStreaming);
            } else if (event.type === "sources") {
              const { sources } = event;
              localStreaming = { ...localStreaming, sources };
              setStreamingState(localStreaming);
            } else if (event.type === "metadata") {
              const { conversationId: cid, messageId } = event;
              finalConversationId = cid;
              localStreaming = { ...localStreaming, conversationId: cid, messageId };
              setStreamingState(localStreaming);
              setActiveConversationId(cid);
              setConversations((prev) => {
                if (prev.some((c) => c.id === cid)) return prev;
                const placeholder: ConversationRow = {
                  id: cid,
                  workspace_id: workspaceId,
                  user_id: "",
                  title: "New conversation",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                return [placeholder, ...prev];
              });
            } else if (event.type === "done") {
              const finalActivities = localStreaming.activities.map((a) => ({ ...a, complete: true }));
              const assistantMsg: UIMessage = {
                id: localStreaming.messageId ?? `assistant-${Date.now()}`,
                role: "assistant",
                content: localStreaming.content,
                sources: localStreaming.sources.length > 0 ? localStreaming.sources : null,
                created_at: new Date().toISOString(),
                activities: finalActivities,
              };
              setMessages((msgs) => [...msgs, assistantMsg]);
              setStreamingState(null);
              void fetchConversations();
            } else if (event.type === "error") {
              const errMsg: UIMessage = {
                id: `err-${Date.now()}`,
                role: "assistant",
                content: `Sorry, something went wrong: ${event.error}`,
                sources: null,
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, errMsg]);
              setStreamingState(null);
            }
          }
        }
      } catch (err) {
        const errMsg: UIMessage = {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `Sorry, I couldn't process your request. Please try again.`,
          sources: null,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
        setStreamingState(null);
        console.error("[cleverbrain] stream error:", err);
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        if (finalConversationId) {
          setTimeout(() => void fetchConversations(), 3000);
        }
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    },
    [activeConversationId, workspaceId, fetchConversations]
  );

  const handleSuggestion = useCallback(
    (text: string) => void sendMessage(text),
    [sendMessage]
  );

  const handleSubmit = useCallback(() => {
    void sendMessage(inputValue);
  }, [inputValue, sendMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const groups = groupConversations(conversations);
  const hasMessages = messages.length > 0 || streamingState !== null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#151515]">
      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden",
          sidebarCollapsed ? "w-0" : "w-[272px]"
        )}
      >
        {/* Top blue gradient section */}
        <div
          className="flex flex-col items-center px-4 pt-6 pb-5"
          style={{
            background: "linear-gradient(180deg, #000000CC 0%, #0167DB 100%)",
          }}
        >
          {/* Cleverfolks logo */}
          <div className="flex justify-center w-full mb-6">
            <Image
              src="/cleverbrain-chat-icons/cleverfolks-logo.png"
              alt="Cleverfolks"
              width={140}
              height={28}
              className="brightness-0 invert"
            />
          </div>

          {/* Brain avatar */}
          <div className="w-[120px] h-[120px] rounded-full overflow-hidden mb-4">
            <Image
              src="/cleverbrain-chat-icons/cleverbrain-icon.png"
              alt="CleverBrain"
              width={120}
              height={120}
            />
          </div>

          {/* Title */}
          <h2 className="text-white font-bold text-lg">Cleverbrain</h2>
          <p className="text-white/60 text-sm mt-0.5">AI for your Business</p>

          {/* New chat button */}
          <button
            onClick={handleNewChat}
            className="mt-4 w-full h-[40px] rounded-full flex items-center justify-center gap-2 text-white text-sm font-medium"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            <span className="text-lg leading-none">+</span>
            Start new chat
          </button>
        </div>

        {/* History section */}
        <div className="flex-1 bg-[#1B1B1B] flex flex-col overflow-hidden">
          {/* History header */}
          <button
            onClick={() => setHistoryCollapsed((v) => !v)}
            className="flex items-center justify-between px-4 py-3 text-white text-sm font-medium hover:bg-white/5 transition-colors"
          >
            <span>History</span>
            {historyCollapsed ? (
              <ChevronDown className="w-4 h-4 text-[#8B8F97]" />
            ) : (
              <ChevronUp className="w-4 h-4 text-[#8B8F97]" />
            )}
          </button>

          {/* Conversation list */}
          {!historyCollapsed && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {(["today", "yesterday", "previous7Days", "older"] as const).map((key) => {
                const label = {
                  today: "Today",
                  yesterday: "Yesterday",
                  previous7Days: "Previous 7 days",
                  older: "Older",
                }[key];
                const items = groups[key];
                if (!items.length) return null;
                return (
                  <div key={key} className="mb-2">
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#555A63]">
                      {label}
                    </div>
                    <div className="space-y-0.5">
                      {items.map((conv) => (
                        <ConvItem
                          key={conv.id}
                          conv={conv}
                          isActive={conv.id === activeConversationId}
                          onClick={() => void loadConversation(conv.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {conversations.length === 0 && (
                <p className="px-3 py-4 text-xs text-[#555A63] text-center">
                  No conversations yet
                </p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Center Chat Area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="h-[60px] flex items-center justify-between px-10 flex-shrink-0 border-b border-[#2A2D35]/40">
          {/* Left: sidebar toggle + search */}
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="text-[#8B8F97] hover:text-white transition-colors mr-1"
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-5 h-5" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </button>
            <div className="relative max-w-[320px] w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555A63]" />
              <input
                type="text"
                placeholder="Search across everything"
                className="w-full bg-[#1E1E1E] border border-[#2A2D35] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#555A63] outline-none focus:border-[#3A89FF]/50 transition-colors"
              />
            </div>
          </div>

          {/* Right: user profile */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <Image
                src="/cleverbrain-chat-icons/organization-dp.png"
                alt="User"
                width={32}
                height={32}
                className="rounded-full"
              />
              <div className="text-right">
                <p className="text-white text-sm font-medium leading-tight">
                  {userName || "User"}
                </p>
                <p className="text-[#8B8F97] text-xs leading-tight">
                  {companyName || "Company"}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-[#8B8F97]" />
            </button>

            {/* Dropdown menu */}
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

        {/* Chat heading */}
        <div className="px-10 pt-5 pb-3 flex-shrink-0">
          <h1 className="text-white font-bold text-2xl">Chat with CleverBrain</h1>
        </div>

        {/* ── Messages / Empty State ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto relative">
          {!hasMessages ? (
            <div className="flex flex-col items-center justify-center h-full px-10 py-12">
              <div className="flex flex-col items-center gap-5 max-w-xl w-full">
                <p className="text-[#8B8F97] text-sm text-center leading-relaxed">
                  Hi! I&apos;m CleverBrain. I have access to your Slack, Gmail, and Calendar data.
                  <br />
                  Ask me anything — I can search across all your connected tools.
                </p>

                {reviewMembers && !reviewDismissed && (
                  <ProfileReviewCard
                    workspaceId={workspaceId}
                    members={reviewMembers}
                    onConfirm={() => setReviewDismissed(true)}
                    onDismiss={() => setReviewDismissed(true)}
                  />
                )}

                <div className="grid grid-cols-2 gap-3 w-full mt-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSuggestion(suggestion)}
                      disabled={isStreaming}
                      className="text-left p-3.5 rounded-xl border border-[#2A2D35] bg-[#1E1E1E] text-[#8B8F97] text-sm leading-snug hover:border-[#3A89FF]/40 hover:bg-[#3A89FF]/5 hover:text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-10 py-8 max-w-4xl mx-auto w-full space-y-8">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}

              {streamingState && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mt-1">
                    <Image
                      src="/cleverbrain-chat-icons/cleverbrain-icon.png"
                      alt="CleverBrain"
                      width={32}
                      height={32}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    {streamingState.activities.length > 0 && (
                      <div className="mb-3 space-y-0.5">
                        {streamingState.activities.map((a, i) => (
                          <ActivityRow key={i} action={a.action} complete={a.complete} />
                        ))}
                      </div>
                    )}
                    {streamingState.content && (
                      <div className="text-[#E0E0E0] text-[15px] leading-[1.75]">
                        <div
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(streamingState.content),
                          }}
                        />
                        {!streamingState.isComplete && (
                          <span className="inline-block w-0.5 h-4 bg-[#3A89FF] ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>
                    )}
                    {!streamingState.content && streamingState.activities.length === 0 && (
                      <div className="flex items-center gap-2 text-[#8B8F97] text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Thinking...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input Area ─────────────────────────────────────────────────── */}
        <div className="px-10 pb-5 pt-3 flex-shrink-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-2 bg-[#2B2B2B] rounded-2xl px-4 py-3 focus-within:ring-1 focus-within:ring-[#3A89FF]/50 transition-all">
              {/* Add media icon */}
              <button className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                <Image
                  src="/cleverbrain-chat-icons/add-media-icon.png"
                  alt="Attach"
                  width={20}
                  height={20}
                  className="opacity-60 hover:opacity-100"
                />
              </button>

              {/* Mic icon */}
              <button className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                <Mic className="w-5 h-5" />
              </button>

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  resizeTextarea(e.target);
                }}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder="Ask CleverBrain Anything about your business"
                rows={1}
                className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed disabled:opacity-50"
                style={{ maxHeight: "160px", overflowY: "auto" }}
              />

              {/* Send button */}
              <button
                onClick={handleSubmit}
                disabled={isStreaming || !inputValue.trim()}
                className="flex-shrink-0 pb-0.5"
                aria-label="Send message"
              >
                {isStreaming ? (
                  <Loader2 className="w-5 h-5 text-[#8B8F97] animate-spin" />
                ) : (
                  <Image
                    src="/cleverbrain-chat-icons/send-prompt-icon.png"
                    alt="Send"
                    width={24}
                    height={24}
                    className={cn(
                      "transition-opacity",
                      inputValue.trim() ? "opacity-100" : "opacity-40"
                    )}
                  />
                )}
              </button>
            </div>

            <p className="text-[#555A63] text-xs text-center mt-2.5">
              CleverBrain searches across all your connected tools to give you answers.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right Icon Bar ────────────────────────────────────────────────── */}
      <RightIconBar />
    </div>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] bg-[#2B2B2B] text-white text-sm rounded-2xl rounded-br-md px-5 py-3.5 leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mt-1">
        <Image
          src="/cleverbrain-chat-icons/cleverbrain-icon.png"
          alt="CleverBrain"
          width={32}
          height={32}
        />
      </div>

      <div className="flex-1 min-w-0">
        {msg.activities && msg.activities.length > 0 && (
          <div className="mb-3 space-y-0.5">
            {msg.activities.map((a, i) => (
              <ActivityRow key={i} action={a.action} complete={true} />
            ))}
          </div>
        )}

        <div className="text-[#E0E0E0] text-[15px] leading-[1.75]">
          <div
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        </div>

        {msg.sources && msg.sources.length > 0 && (
          <SourcePills sources={msg.sources} />
        )}
      </div>
    </div>
  );
}

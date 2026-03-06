"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain,
  Plus,
  Send,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  FileText,
  Calendar,
  Database,
  Hash,
  UserCheck,
  X,
  Edit2,
  Globe,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  activities?: ActivityItem[]; // only on assistant messages from current session
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

// ── Markdown renderer (regex-based, no external library) ─────────────────────

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
    // Code block fence
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

    // Determine if this line starts a list item
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
  // Unclosed code block
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

// ── Source icon ───────────────────────────────────────────────────────────────

function SourceIcon({ sourceType }: { sourceType: string }) {
  const cls = "w-3 h-3 flex-shrink-0";
  switch (sourceType) {
    case "slack_message":
    case "slack_reply":
      return <Hash className={cls} />;
    case "email":
      return <Mail className={cls} />;
    case "document":
    case "attachment":
      return <FileText className={cls} />;
    case "calendar_event":
    case "outlook_event":
      return <Calendar className={cls} />;
    case "gmail_message":
    case "outlook_email":
      return <Mail className={cls} />;
    case "web":
      return <Globe className={cls} />;
    case "cleverbrain_chat":
      return <MessageSquare className={cls} />;
    case "hubspot_contact":
    case "hubspot_company":
    case "hubspot_deal":
    case "hubspot_ticket":
    case "hubspot_task":
    case "hubspot_note":
      return <Database className={cls} />;
    default:
      return <Database className={cls} />;
  }
}

// ── Source pills ──────────────────────────────────────────────────────────────

function SourcePills({ sources }: { sources: SourceInfo[] }) {
  if (!sources.length) return null;
  // Deduplicate by source_type + channel/title
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
    <div className="flex flex-wrap gap-1.5 mt-2">
      {displayed.map((src, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-[#131619] border border-[#2A2D35] rounded-full text-[#8B8F97] text-xs px-2.5 py-1"
        >
          <SourceIcon sourceType={src.source_type} />
          <span className="truncate max-w-[140px]">
            {src.channel ?? src.title ?? src.source_type}
          </span>
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex items-center bg-[#131619] border border-[#2A2D35] rounded-full text-[#8B8F97] text-xs px-2.5 py-1">
          +{remaining} more
        </span>
      )}
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
          ? "bg-[#3A89FF]/15 text-[#3A89FF]"
          : "text-[#8B8F97] hover:bg-[#1C1F24] hover:text-white"
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
      // Collect only edits that differ from the detected role
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
      /* swallow — card will just close */
      onConfirm();
    } finally {
      setIsConfirming(false);
    }
  }

  if (uncertainMembers.length === 0) return null;

  return (
    <div className="w-full bg-[#1C1F24] border border-[#3A89FF]/30 rounded-2xl p-4 mb-4">
      {/* Header */}
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

      {/* Member rows */}
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
                className="flex-1 bg-[#131619] border border-[#3A89FF]/50 rounded-lg px-2 py-1 text-sm text-white outline-none"
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

      {/* Actions */}
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

// ── Main component ────────────────────────────────────────────────────────────

export function CleverBrainClient({ workspaceId }: { workspaceId: string }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Profile review card state
  const [reviewMembers, setReviewMembers] = useState<TeamMemberForReview[] | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreamingRef = useRef(false); // shadow for stable reference in async

  // ── Load conversations on mount ──────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    const { conversations: data } = await getConversationsAction(workspaceId);
    setConversations(data);
  }, [workspaceId]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  // ── Check if profile needs role review ───────────────────────────────────
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
        // Show card only when profile is pending_review and not yet confirmed
        if (data.status === "pending_review" && !data.confirmed) {
          const uncertain = data.team_members.filter(
            (m) => m.confidence === "low" || m.confidence === "medium"
          );
          if (uncertain.length > 0) setReviewMembers(uncertain);
        }
      } catch {
        /* silently ignore — the review card is optional */
      }
    }
    void checkProfileReview();
  }, [workspaceId]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingState?.content, streamingState?.activities?.length]);

  // ── Load conversation messages ───────────────────────────────────────────
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

  // ── New chat ─────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setStreamingState(null);
    setInputValue("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // ── Textarea auto-resize ─────────────────────────────────────────────────
  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  // ── Send message + SSE stream handling ──────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreamingRef.current) return;

      isStreamingRef.current = true;
      setIsStreaming(true);
      setInputValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Optimistic user message
      const tempId = `temp-${Date.now()}`;
      const userMsg: UIMessage = {
        id: tempId,
        role: "user",
        content: trimmed,
        sources: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Init streaming state
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

      // Local mirror of streaming state — updated in sync with setStreamingState.
      // This avoids reading React state inside another setState updater (which React
      // Strict Mode would call twice, causing duplicate messages in the done handler).
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
              // Optimistically add new conversation to sidebar if not present
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
              // Finalize: move streaming message into messages list.
              // We read from localStreaming (not React state) to avoid the React Strict Mode
              // double-invocation bug that would occur if we nested setMessages inside
              // setStreamingState's updater function.
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

              // Refetch conversations to pick up auto-title
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
        // If we got a conversationId from the stream, ensure sidebar is updated
        if (finalConversationId) {
          setTimeout(() => void fetchConversations(), 3000); // pick up auto-title
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

  // ── Keyboard handler ─────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // ── Sidebar groups ───────────────────────────────────────────────────────
  const groups = groupConversations(conversations);
  const hasMessages = messages.length > 0 || streamingState !== null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col bg-[#131619] border-r border-[#2A2D35] flex-shrink-0 transition-all duration-300 overflow-hidden",
          sidebarCollapsed ? "w-0" : "w-[280px]"
        )}
      >
        {/* New chat button */}
        <div className="p-3 border-b border-[#2A2D35]">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-[#8B8F97] hover:bg-[#1C1F24] hover:text-white transition-colors"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>New chat</span>
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
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
              <div key={key} className="mb-3">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#555A63]">
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
      </aside>

      {/* ── Right Panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="absolute top-3 left-3 z-10 flex items-center justify-center w-7 h-7 rounded-lg bg-[#1C1F24] border border-[#2A2D35] text-[#8B8F97] hover:text-white hover:bg-[#2A2D35] transition-colors"
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>

        {/* ── Messages / Empty State ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!hasMessages ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full px-6 py-12">
              <div className="flex flex-col items-center gap-4 max-w-lg w-full">
                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl bg-[#3A89FF]/10 flex items-center justify-center">
                  <Brain className="w-7 h-7 text-[#3A89FF]" />
                </div>
                {/* Heading */}
                <h1 className="font-heading font-semibold text-2xl text-white text-center">
                  What would you like to know?
                </h1>
                {/* Subtext */}
                <p className="text-[#8B8F97] text-sm text-center leading-relaxed">
                  CleverBrain has access to your connected integrations. Ask about conversations,
                  documents, emails, and more.
                </p>

                {/* Profile review card */}
                {reviewMembers && !reviewDismissed && (
                  <ProfileReviewCard
                    workspaceId={workspaceId}
                    members={reviewMembers}
                    onConfirm={() => setReviewDismissed(true)}
                    onDismiss={() => setReviewDismissed(true)}
                  />
                )}

                {/* Suggestion cards */}
                <div className="grid grid-cols-2 gap-3 w-full mt-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSuggestion(suggestion)}
                      disabled={isStreaming}
                      className="text-left p-3.5 rounded-xl border border-[#2A2D35] bg-[#131619] text-[#8B8F97] text-sm leading-snug hover:border-[#3A89FF]/40 hover:bg-[#3A89FF]/5 hover:text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Messages list */
            <div className="px-4 py-6 max-w-3xl mx-auto w-full space-y-6">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}

              {/* Streaming assistant message */}
              {streamingState && (
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#3A89FF]/15 flex items-center justify-center flex-shrink-0 mt-1">
                    <Brain className="w-4 h-4 text-[#3A89FF]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Activity indicators */}
                    {streamingState.activities.length > 0 && (
                      <div className="mb-3 space-y-0.5">
                        {streamingState.activities.map((a, i) => (
                          <ActivityRow key={i} action={a.action} complete={a.complete} />
                        ))}
                      </div>
                    )}

                    {/* Streaming text bubble */}
                    {streamingState.content && (
                      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl rounded-bl-md px-4 py-3 text-[#E0E0E0] text-sm leading-relaxed">
                        <div
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(streamingState.content),
                          }}
                        />
                        {/* Blinking cursor while streaming */}
                        {!streamingState.isComplete && (
                          <span className="inline-block w-0.5 h-4 bg-[#3A89FF] ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>
                    )}

                    {/* Thinking indicator when no content yet */}
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

        {/* ── Input Area ──────────────────────────────────────────────────── */}
        <div className="border-t border-[#2A2D35] px-6 py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Input container */}
            <div className="flex items-end gap-3 bg-[#131619] border border-[#2A2D35] rounded-xl px-4 py-3 focus-within:border-[#3A89FF]/50 transition-colors">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  resizeTextarea(e.target);
                }}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder="Ask CleverBrain anything..."
                rows={1}
                className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed disabled:opacity-50"
                style={{ maxHeight: "160px", overflowY: "auto" }}
              />

              {/* Send button */}
              <button
                onClick={handleSubmit}
                disabled={isStreaming || !inputValue.trim()}
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                  isStreaming || !inputValue.trim()
                    ? "text-[#555A63] cursor-not-allowed"
                    : "bg-[#3A89FF] text-white hover:bg-[#2d7aff]"
                )}
                aria-label="Send message"
              >
                {isStreaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Helper text */}
            <p className="text-[#555A63] text-xs text-center mt-2">
              CleverBrain searches your connected integrations to answer questions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MessageBubble component ───────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-[#3A89FF] text-white text-sm rounded-2xl rounded-br-md px-4 py-3 leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-[#3A89FF]/15 flex items-center justify-center flex-shrink-0 mt-1">
        <Brain className="w-4 h-4 text-[#3A89FF]" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Activity indicators (from current session — static all-checked) */}
        {msg.activities && msg.activities.length > 0 && (
          <div className="mb-3 space-y-0.5">
            {msg.activities.map((a, i) => (
              <ActivityRow key={i} action={a.action} complete={true} />
            ))}
          </div>
        )}

        {/* Message bubble */}
        <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl rounded-bl-md px-4 py-3 text-[#E0E0E0] text-sm leading-relaxed">
          <div
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        </div>

        {/* Source citations */}
        {msg.sources && msg.sources.length > 0 && (
          <SourcePills sources={msg.sources} />
        )}
      </div>
    </div>
  );
}


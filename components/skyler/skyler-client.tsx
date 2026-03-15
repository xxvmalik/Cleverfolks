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
  Eye,
  X,
  Send,
  MoreHorizontal,
  Star,
  Pencil,
  Trash2,
  MessageSquare,
  CornerUpLeft,
  Lightbulb,
  AlertTriangle,
  FileText,
  CheckCircle,
  Clock,
  ScrollText,
  HelpCircle,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { ActionApproval } from "@/components/skyler/action-approval";
import { WorkflowSettings } from "@/components/skyler/workflow-settings";
import { MeetingsPanel } from "@/components/skyler/meetings-panel";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkflowTab = "lead-qualification" | "prospect-engagement" | "sales-closer" | "workflows-settings";

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

/** Highlighted lead/email attached to a user message (WhatsApp reply-quote style) */
type MessageHighlight = {
  /** "lead" = lead qualification card, "pipeline" = pipeline card, "email" = specific email in a thread */
  kind: "lead" | "pipeline" | "email";
  contactName: string;
  companyName?: string;
  /** Preview snippet — first few words of the email, or lead detail */
  preview?: string;
  /** Email subject (for email highlights) */
  subject?: string;
  /** Stage label */
  stage?: string;
  /** Score / classification for lead cards */
  classification?: string;
  potential?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  highlight?: MessageHighlight;
};

type ConversationItem = {
  id: string;
  title: string;
  updated_at: string;
  is_starred?: boolean;
  custom_title?: string | null;
};

/** WhatsApp-style highlight quote shown above user message text */
function HighlightQuote({ highlight }: { highlight: MessageHighlight }) {
  return (
    <div className="mb-2 rounded-md bg-[#F2903D]/10 border-l-[3px] border-l-[#F2903D] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <Target className="w-3 h-3 text-[#F2903D] flex-shrink-0" />
        <span className="text-[11px] text-[#F2903D] font-semibold truncate">{highlight.contactName}</span>
        {highlight.companyName && (
          <span className="text-[10px] text-[#F2903D]/60 truncate">· {highlight.companyName}</span>
        )}
        {highlight.stage && (
          <span className="text-[9px] text-[#8B8F97] bg-white/5 px-1.5 py-0.5 rounded-full flex-shrink-0">{formatStage(highlight.stage)}</span>
        )}
      </div>
      {/* Email highlight: show subject + snippet */}
      {highlight.kind === "email" && (
        <p className="text-[10px] text-[#8B8F97] mt-0.5 truncate">
          {highlight.subject ? `"${highlight.subject}" — ` : ""}{highlight.preview ?? ""}
        </p>
      )}
      {/* Lead card highlight: show classification */}
      {highlight.kind === "lead" && highlight.classification && (
        <p className="text-[10px] text-[#8B8F97] mt-0.5">{highlight.classification} lead{highlight.potential ? ` · ${highlight.potential}` : ""}</p>
      )}
    </div>
  );
}

/** Unescape HTML entities that may be double-escaped in JSONB storage */
function unescapeHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse email body from chunk_text format — strip metadata headers if present. */
function parseEmailBody(content: string): string {
  // If content starts with "From:" header, find the double-newline separator
  // and return everything after it (the actual email body)
  if (content.startsWith("From:")) {
    const bodyStart = content.indexOf("\n\n");
    if (bodyStart !== -1) {
      return content.slice(bodyStart + 2).trim();
    }
  }

  // Strip HTML tags for display
  const stripped = content.replace(/<[^>]+>/g, "").trim();
  return stripped || content;
}

// ── Conversation Item (with star / rename / delete) ──────────────────────────

function SkylerConvItem({
  conv,
  isActive,
  onClick,
  onStar,
  onRename,
  onDelete,
}: {
  conv: ConversationItem;
  isActive: boolean;
  onClick: () => void;
  onStar: (id: string, starred: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.custom_title ?? conv.title ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (renaming) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(conv.id, renameValue); setRenaming(false); }
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={() => { onRename(conv.id, renameValue); setRenaming(false); }}
          className="w-full bg-[#2A2A2A] border border-[#3A89FF]/50 rounded-lg px-3 py-1.5 text-xs text-white outline-none"
        />
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="px-2 py-1.5 bg-[#F87171]/10 border border-[#F87171]/30 rounded-lg mx-1">
        <p className="text-[#F87171] text-xs mb-2">Delete this conversation?</p>
        <div className="flex gap-2">
          <button onClick={() => { onDelete(conv.id); setConfirmDelete(false); }} className="px-2 py-1 bg-[#F87171]/20 text-[#F87171] rounded text-xs hover:bg-[#F87171]/30">Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 bg-white/5 text-[#8B8F97] rounded text-xs hover:bg-white/10">Cancel</button>
        </div>
      </div>
    );
  }

  const displayTitle = conv.custom_title || conv.title || "New conversation";
  const isExpanded = menuOpen || confirmDelete || renaming;

  return (
    <div className={cn("group relative flex items-center", isExpanded && "z-10")}>
      <button
        onClick={onClick}
        className={cn(
          "w-full text-left px-3 py-2 rounded-lg text-xs truncate transition-colors duration-150 flex items-center gap-1.5",
          isActive
            ? "bg-white/10 text-white"
            : "text-[#8B8F97] hover:bg-white/5 hover:text-white"
        )}
      >
        {conv.is_starred && <Star className="w-3 h-3 text-[#FBB040] fill-[#FBB040] flex-shrink-0" />}
        <span className="truncate">{displayTitle}</span>
      </button>
      <div ref={menuRef} className="absolute right-1 top-1/2 -translate-y-1/2">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-opacity"
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-[#8B8F97]" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-[#1C1F24] border border-[#2A2D35] rounded-lg shadow-xl py-1 z-50 w-36">
            <button
              onClick={() => { onStar(conv.id, !conv.is_starred); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#E0E0E0] hover:bg-white/5 flex items-center gap-2"
            >
              <Star className={cn("w-3 h-3", conv.is_starred ? "text-[#FBB040] fill-[#FBB040]" : "text-[#8B8F97]")} />
              {conv.is_starred ? "Unstar" : "Star"}
            </button>
            <button
              onClick={() => { setRenaming(true); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#E0E0E0] hover:bg-white/5 flex items-center gap-2"
            >
              <Pencil className="w-3 h-3 text-[#8B8F97]" />
              Rename
            </button>
            <button
              onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#F87171] hover:bg-white/5 flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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

// ── Action types ──────────────────────────────────────────────────────────────

type PendingAction = {
  id: string;
  description: string;
};

// ── Pinned context type (reply-to-email feedback) ───────────────────────────

type PinnedLeadContext = {
  /** Source: "lead" for lead-qualification cards, "pipeline" for sales-closer records */
  source: "lead" | "pipeline";
  /** Lead ID or Pipeline record ID */
  sourceId: string;
  contactName: string;
  companyName: string;
  contactEmail?: string;
  stage?: string;
  /** Lead-specific fields */
  classification?: string;
  potential?: string;
  /** Optional: when replying to a specific email in a thread */
  email?: {
    role: string;
    subject?: string;
    content: string;
    timestamp: string;
    status?: string;
  };
};

// ── Sales Closer types ───────────────────────────────────────────────────────

type ConvoThreadEntry = {
  role: string;
  content: string;
  subject?: string;
  timestamp: string;
  status?: string;
};

type SkylerNote = {
  type: string;
  message: string;
  created_at: string;
  resolved: boolean;
  resolved_at?: string;
  action?: string;
};

type MeetingOutcome = {
  outcome?: string;
  reasoning?: string;
  key_discussion_points?: string[];
  follow_up_date?: string;
  skyler_tasks?: Array<{ task: string; follow_up_date?: string; context: string }>;
  user_tasks?: Array<{ task: string; deadline?: string; context: string }>;
  error?: string;
};

type ActionNote = {
  task: string;
  deadline?: string;
  context: string;
  completed: boolean;
  notified: boolean;
  source?: string;
};

type PipelineRecord = {
  id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  stage: string;
  emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  cadence_step: number;
  resolution: string | null;
  updated_at: string;
  conversation_thread: ConvoThreadEntry[];
  skyler_note?: SkylerNote | null;
  meeting_transcript?: string | null;
  meeting_outcome?: MeetingOutcome | null;
  action_notes?: ActionNote[] | null;
  pending_actions: Array<{
    id: string;
    description: string;
    tool_input?: {
      to?: string;
      subject?: string;
      htmlBody?: string;
      textBody?: string;
      pipelineId?: string;
    };
  }>;
  directive_count?: number;
  pending_requests?: Array<{
    id: string;
    request_description: string;
    created_at: string;
  }>;
  meeting_count?: number;
};

type PerformanceMetrics = {
  totalLeads: number;
  emailsSent: number;
  replyRate: number;
  meetingsBooked: number;
  paymentsSecured: number;
  dealsWon: number;
  conversionRate: number;
};

const STAGE_COLORS: Record<string, string> = {
  initial_outreach: "#3A89FF",
  follow_up_1: "#FB923C",
  follow_up_2: "#FB923C",
  follow_up_3: "#FB923C",
  replied: "#4ADE80",
  negotiation: "#F2903D",
  demo_booked: "#7C3AED",
  payment_secured: "#4ADE80",
  closed_won: "#4ADE80",
  disqualified: "#F87171",
  stalled: "#8B8F97",
  pending_clarification: "#FBB040",
  meeting_booked: "#06B6D4",
  follow_up_meeting: "#3B82F6",
  proposal: "#F2903D",
  closed_lost: "#F87171",
};

function formatStage(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSkylerUnavailableMessage(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 9) return "Skyler is grabbing her morning coffee ☕ She'll be back shortly!";
  if (hour >= 9 && hour < 12) return "Skyler just stepped into a quick meeting. She'll be right back!";
  if (hour >= 12 && hour < 14) return "Skyler is currently on her lunch break 🍽️ She'll be back soon!";
  if (hour >= 14 && hour < 17) return "Skyler is recharging with a quick power nap. Back in a moment!";
  if (hour >= 17 && hour < 21) return "Skyler has clocked out for the evening 🌅 She'll be back shortly!";
  return "Skyler is getting her beauty sleep 🌙 She'll be fresh and ready soon!";
}

// ── Directives Badge (hover popover on lead cards) ──────────────────────────

function DirectivesBadge({ pipelineId, count }: { pipelineId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [directives, setDirectives] = useState<Array<{ id: string; directive_text: string; created_at: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  const handleOpen = async () => {
    setOpen(true);
    if (!loaded) {
      try {
        const res = await fetch(`/api/skyler/directives?pipelineId=${pipelineId}`);
        if (res.ok) {
          const data = await res.json();
          setDirectives(data.directives ?? []);
        }
      } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const handleDeactivate = async (directiveId: string) => {
    try {
      await fetch(`/api/skyler/directives?id=${directiveId}`, { method: "DELETE" });
      setDirectives((prev) => prev.filter((d) => d.id !== directiveId));
    } catch { /* ignore */ }
  };

  return (
    <div className="relative">
      <button
        onMouseEnter={handleOpen}
        onMouseLeave={() => setOpen(false)}
        className="flex items-center gap-1 px-2 py-1 bg-[#7C3AED]/10 border border-[#7C3AED]/30 rounded-full text-[#7C3AED] text-[10px] font-medium"
        title="Active directives for this lead"
      >
        <ScrollText className="w-3 h-3" />
        {count}
      </button>
      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-1 z-50 w-64 bg-[#1C1F24] border border-[#2A2D35] rounded-lg shadow-xl p-3"
        >
          <p className="text-[#7C3AED] text-[10px] font-semibold uppercase mb-2">Your Instructions</p>
          {directives.length === 0 && loaded ? (
            <p className="text-[#8B8F97] text-xs">No active directives</p>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {directives.map((d) => (
                <div key={d.id} className="flex items-start gap-2 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#E0E0E0] text-xs leading-relaxed">&ldquo;{d.directive_text}&rdquo;</p>
                    <p className="text-[#555A63] text-[10px] mt-0.5">
                      {new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeactivate(d.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-[#8B8F97] hover:text-[#F87171] transition-all"
                    title="Remove directive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  // Map of messageId -> pending actions to show below that message
  const [messageActions, setMessageActions] = useState<Record<string, PendingAction[]>>({});

  // Sales Closer state
  const [pipelineRecords, setPipelineRecords] = useState<PipelineRecord[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [previewActionId, setPreviewActionId] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState<Record<string, string>>({});
  const [threadOpenId, setThreadOpenId] = useState<string | null>(null);
  const [transcriptOpenId, setTranscriptOpenId] = useState<string | null>(null);
  const [meetingsOpenId, setMeetingsOpenId] = useState<string | null>(null);
  const [pinnedContext, setPinnedContext] = useState<PinnedLeadContext | null>(null);

  // Fetch dashboard data — uses lead_scores endpoints, falls back to deal-based dashboard
  const fetchDashboard = useCallback(async () => {
    try {
      const [leadStatsRes, leadsRes, dashRes, logosRes] = await Promise.all([
        fetch(`/api/skyler/lead-stats?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/leads?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/dashboard?workspaceId=${workspaceId}`),
        fetch(`/api/integration-logos?workspaceId=${workspaceId}`),
      ]);

      // Try lead_scores first (Piece 3+5 data)
      let usedLeadScores = false;
      if (leadStatsRes.ok && leadsRes.ok) {
        const statsData = await leadStatsRes.json();
        const leadsData = await leadsRes.json();
        if (statsData.stats?.totalScored > 0) {
          usedLeadScores = true;
          // Also get sales closer + integrations from old dashboard
          let salesCloser = false;
          let integrations: { id: string; provider: string }[] = [];
          if (dashRes.ok) {
            const oldData = await dashRes.json();
            salesCloser = oldData.salesCloserEnabled ?? false;
            integrations = oldData.connectedIntegrations ?? [];
          }
          setDashData({
            stats: statsData.stats,
            leads: leadsData.leads ?? [],
            connectedIntegrations: integrations,
            salesCloserEnabled: salesCloser,
          });
          setSalesCloserEnabled(salesCloser);
        }
      }

      // Fallback to old deal-based dashboard if no lead scores exist yet
      if (!usedLeadScores && dashRes.ok) {
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

  // Fetch Sales Closer data
  const fetchSalesCloserData = useCallback(async () => {
    setPipelineLoading(true);
    try {
      const [pipelineRes, perfRes] = await Promise.all([
        fetch(`/api/skyler/sales-pipeline?workspaceId=${workspaceId}`),
        fetch(`/api/skyler/performance?workspaceId=${workspaceId}`),
      ]);
      if (pipelineRes.ok) {
        const data = await pipelineRes.json();
        setPipelineRecords(data.records ?? []);
      }
      if (perfRes.ok) {
        const data = await perfRes.json();
        setPerformanceMetrics(data.metrics ?? null);
      }
    } finally {
      setPipelineLoading(false);
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

  // Fetch sales closer data when tab is active
  useEffect(() => {
    if (activeTab === "sales-closer") {
      fetchSalesCloserData();
    }
  }, [activeTab, fetchSalesCloserData]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  // Poll for pending actions every 3 seconds when we have an active conversation
  useEffect(() => {
    if (!activeConversationId || isStreaming) return;

    const pollActions = async () => {
      try {
        const res = await fetch(
          `/api/skyler/actions?workspaceId=${workspaceId}&conversationId=${activeConversationId}&status=pending`
        );
        if (!res.ok) return;
        const data = await res.json();
        const pending: PendingAction[] = (data.actions ?? [])
          .filter((a: { status: string }) => a.status === "pending")
          .map((a: { id: string; description: string }) => ({
            id: a.id,
            description: a.description,
          }));

        if (pending.length > 0) {
          // Attach to the last assistant message
          const lastAssistantMsg = [...chatMessages].reverse().find((m) => m.role === "assistant");
          if (lastAssistantMsg) {
            setMessageActions((prev) => {
              const existing = prev[lastAssistantMsg.id] ?? [];
              const existingIds = new Set(existing.map((a) => a.id));
              const newActions = pending.filter((a) => !existingIds.has(a.id));
              if (newActions.length === 0) return prev;
              return { ...prev, [lastAssistantMsg.id]: [...existing, ...newActions] };
            });
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    // Poll immediately once, then every 3 seconds
    pollActions();
    const interval = setInterval(pollActions, 3000);
    return () => clearInterval(interval);
  }, [activeConversationId, isStreaming, workspaceId, chatMessages]);

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

    // Capture and clear pinned context before sending
    const currentPinnedContext = pinnedContext;
    setPinnedContext(null);

    // Build per-message highlight from whatever was pinned
    let highlight: MessageHighlight | undefined;
    if (currentPinnedContext) {
      if (currentPinnedContext.email) {
        // Email-level highlight — show contact + snippet of email content
        highlight = {
          kind: "email",
          contactName: currentPinnedContext.contactName,
          companyName: currentPinnedContext.companyName,
          subject: currentPinnedContext.email.subject,
          preview: parseEmailBody(currentPinnedContext.email.content).slice(0, 80),
          stage: currentPinnedContext.stage,
        };
      } else if (currentPinnedContext.source === "pipeline") {
        // Pipeline card highlight
        highlight = {
          kind: "pipeline",
          contactName: currentPinnedContext.contactName,
          companyName: currentPinnedContext.companyName,
          stage: currentPinnedContext.stage,
        };
      } else {
        // Lead card highlight
        highlight = {
          kind: "lead",
          contactName: currentPinnedContext.contactName,
          companyName: currentPinnedContext.companyName,
          classification: currentPinnedContext.classification,
          potential: currentPinnedContext.potential,
        };
      }
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      ...(highlight && { highlight }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setActivityLabel("Thinking...");
    setStreamingContent("");
    // Track the conversation ID for this request (may be set mid-stream)
    let currentConversationId = activeConversationId;

    try {
      // Build request body — include pipeline context if pinned
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chatBody: Record<string, any> = {
        message: trimmed,
        workspaceId,
        conversationId: activeConversationId ?? undefined,
      };
      if (currentPinnedContext) {
        chatBody.pipelineContext = {
          source: currentPinnedContext.source,
          pipeline_id: currentPinnedContext.sourceId,
          contact_name: currentPinnedContext.contactName,
          company_name: currentPinnedContext.companyName,
          contact_email: currentPinnedContext.contactEmail,
          stage: currentPinnedContext.stage,
          ...(currentPinnedContext.email && { referenced_email: currentPinnedContext.email }),
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

            if (event.type === "activity") {
              setActivityLabel(event.action);
            } else if (event.type === "text") {
              accumulatedText += event.text;
              setStreamingContent(accumulatedText);
              setActivityLabel(null);
            } else if (event.type === "metadata") {
              if (event.conversationId) {
                currentConversationId = event.conversationId;
                if (!activeConversationId) {
                  setActiveConversationId(event.conversationId);
                }
              }
            } else if (event.type === "done") {
              // Finalize the assistant message
              const msgId = `assistant-${Date.now()}`;
              const assistantMsg: ChatMessage = {
                id: msgId,
                role: "assistant",
                content: accumulatedText,
              };
              setChatMessages((prev) => [...prev, assistantMsg]);
              setStreamingContent("");
              setActivityLabel(null);

              // Fetch pending actions from API (bulletproof — DB is source of truth)
              const convIdForActions = currentConversationId;
              console.log("[skyler] Stream done. Polling for pending actions, conversationId:", convIdForActions);
              if (convIdForActions) {
                try {
                  const actionsUrl = `/api/skyler/actions?workspaceId=${workspaceId}&conversationId=${convIdForActions}&status=pending`;
                  console.log("[skyler] Fetching:", actionsUrl);
                  const actionsRes = await fetch(actionsUrl);
                  console.log("[skyler] Actions response status:", actionsRes.status);
                  if (actionsRes.ok) {
                    const actionsData = await actionsRes.json();
                    console.log("[skyler] Actions data:", JSON.stringify(actionsData));
                    const pending: PendingAction[] = (actionsData.actions ?? [])
                      .filter((a: { status: string }) => a.status === "pending")
                      .map((a: { id: string; description: string }) => ({
                        id: a.id,
                        description: a.description,
                      }));
                    if (pending.length > 0) {
                      console.log("[skyler] Found", pending.length, "pending actions, attaching to message", msgId);
                      setMessageActions((prev) => ({ ...prev, [msgId]: pending }));
                    } else {
                      console.log("[skyler] No pending actions found");
                    }
                  }
                } catch (actionsErr) {
                  console.error("[skyler] Failed to fetch pending actions:", actionsErr);
                }
              } else {
                console.warn("[skyler] No conversationId available — cannot poll for pending actions");
              }

              // Refresh conversation list
              fetchConversations();
            } else if (event.type === "error") {
              const friendlyMsg = event.error === "ai_unavailable"
                ? getSkylerUnavailableMessage()
                : `Something went wrong. Please try again.`;
              const errorMsg: ChatMessage = {
                id: `error-${Date.now()}`,
                role: "assistant",
                content: friendlyMsg,
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
      // Delayed refresh to pick up auto-generated title
      setTimeout(() => fetchConversations(), 3000);
    }
  }

  // New chat
  function handleNewChat() {
    setActiveConversationId(null);
    setChatMessages([]);

    setStreamingContent("");
    setActivityLabel(null);
    setMessageActions({});
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  // Load conversation
  async function loadConversation(convId: string) {
    setActiveConversationId(convId);
    setChatMessages([]);

    setStreamingContent("");
    setMessageActions({});
    try {
      const [msgsRes, actionsRes] = await Promise.all([
        fetch(`/api/skyler/conversations/${convId}/messages`),
        fetch(`/api/skyler/actions?workspaceId=${workspaceId}&conversationId=${convId}&status=pending`),
      ]);
      let loadedMessages: ChatMessage[] = [];
      if (msgsRes.ok) {
        const data = await msgsRes.json();
        loadedMessages = (data.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        setChatMessages(loadedMessages);
      }
      // Attach pending actions to the last assistant message
      if (actionsRes.ok) {
        const actionsData = await actionsRes.json();
        const pending: PendingAction[] = (actionsData.actions ?? [])
          .filter((a: { status: string }) => a.status === "pending")
          .map((a: { id: string; description: string }) => ({
            id: a.id,
            description: a.description,
          }));
        if (pending.length > 0) {
          const lastAssistant = [...loadedMessages].reverse().find((m) => m.role === "assistant");
          if (lastAssistant) {
            setMessageActions({ [lastAssistant.id]: pending });
          }
        }
      }
    } catch {
      // Silently ignore
    }
  }

  // ── Conversation management handlers ────────────────────────────────────
  async function handleStarConversation(id: string, starred: boolean) {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, is_starred: starred } : c));
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_starred: starred }),
    });
  }

  async function handleRenameConversation(id: string, title: string) {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, custom_title: title || null } : c));
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_title: title }),
    });
  }

  async function handleDeleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setChatMessages([]);
  
    }
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  }

  const starredConvs = conversations.filter((c) => c.is_starred);
  const unstarredConvs = conversations.filter((c) => !c.is_starred);

  const leads = dashData?.leads ?? [];
  const stats = dashData?.stats ?? { qualificationRate: 0, hotLeads: 0, nurtureQueue: 0, disqualified: 0 };

  const filteredLeads = leads.filter((lead) => {
    if (leadFilter === "all") return true;
    // Use classification if available (from lead_scores), fall back to priority
    if (lead.classification) {
      return lead.classification === leadFilter;
    }
    if (leadFilter === "hot") return lead.priority === "High";
    if (leadFilter === "nurture") return lead.priority === "Medium" || lead.priority === "Low";
    if (leadFilter === "disqualified") return false;
    return true;
  });

  // Sales Closer: approve/reject email draft
  const [sendError, setSendError] = useState<Record<string, string>>({});
  const [sendingAction, setSendingAction] = useState<string | null>(null);

  async function handleApproveDraft(pipelineId: string, actionId: string) {
    setSendingAction(actionId);
    setSendError((prev) => { const next = { ...prev }; delete next[actionId]; return next; });
    try {
      const res = await fetch(`/api/skyler/sales-pipeline/${pipelineId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId }),
      });
      if (res.ok) {
        fetchSalesCloserData(); // Refresh
      } else {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error ?? "";
        const friendlyError = errMsg === "ai_unavailable"
          ? "Skyler can't process this right now. Your draft is saved — you can retry shortly."
          : errMsg.includes("No email provider connected")
          ? "Connect your Gmail or Outlook in Integrations to send emails."
          : (errMsg || "Send failed — your draft is saved, try again.");
        setSendError((prev) => ({ ...prev, [actionId]: friendlyError }));
      }
    } catch {
      setSendError((prev) => ({ ...prev, [actionId]: "Network error — please try again" }));
    } finally {
      setSendingAction(null);
    }
  }

  async function handleRejectDraft(pipelineId: string, actionId: string, feedback?: string) {
    try {
      await fetch(`/api/skyler/sales-pipeline/${pipelineId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, feedback }),
      });
      fetchSalesCloserData();
    } catch {
      // Silently handle
    }
  }

  function handlePromptLead(lead: Lead) {
    setPinnedContext({
      source: "lead",
      sourceId: lead.id,
      contactName: lead.contact_name ?? lead.company,
      companyName: lead.company,
      contactEmail: lead.contact_email,
      stage: lead.classification ?? undefined,
      classification: lead.classification ?? undefined,
      potential: lead.potential,
    });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handlePromptPipeline(rec: PipelineRecord) {
    setPinnedContext({
      source: "pipeline",
      sourceId: rec.id,
      contactName: rec.contact_name || rec.contact_email,
      companyName: rec.company_name ?? "",
      contactEmail: rec.contact_email,
      stage: rec.stage,
    });
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
              {/* Starred section */}
              {starredConvs.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#FBB040]/70 flex items-center gap-1">
                    <Star className="w-2.5 h-2.5 fill-[#FBB040] text-[#FBB040]" />
                    Starred
                  </div>
                  <div className="space-y-0.5">
                    {starredConvs.map((conv) => (
                      <SkylerConvItem
                        key={conv.id}
                        conv={conv}
                        isActive={conv.id === activeConversationId}
                        onClick={() => loadConversation(conv.id)}
                        onStar={handleStarConversation}
                        onRename={handleRenameConversation}
                        onDelete={handleDeleteConversation}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Unstarred conversations */}
              {unstarredConvs.length > 0 && (
                <div className="space-y-0.5">
                  {unstarredConvs.map((conv) => (
                    <SkylerConvItem
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === activeConversationId}
                      onClick={() => loadConversation(conv.id)}
                      onStar={handleStarConversation}
                      onRename={handleRenameConversation}
                      onDelete={handleDeleteConversation}
                    />
                  ))}
                </div>
              )}

              {conversations.length === 0 && (
                <p className="px-3 py-4 text-xs text-[#555A63] text-center">
                  No conversations yet
                </p>
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

          {/* ── Sales Closer Tab ─────────────────────────────────────── */}
          {activeTab === "sales-closer" && (
            <>
              {/* Header */}
              <div className="bg-[#111111] px-6 py-5 border-b border-[#2A2D35]/30">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1.5">
                      <h2 className="text-white font-bold text-lg">Sales Closer</h2>
                      <ToggleSwitch enabled={salesCloserEnabled} onToggle={handleSalesCloserToggle} />
                    </div>
                    <p className="text-[#8B8F97] text-sm">
                      Skyler manages outreach, follow-ups, and conversations with qualified leads. All emails require your approval.
                    </p>
                  </div>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="px-6 py-4 flex gap-4">
                <StatCard label="Emails Sent" value={pipelineLoading ? "..." : String(performanceMetrics?.emailsSent ?? 0)} />
                <StatCard label="Reply Rate" value={pipelineLoading ? "..." : `${performanceMetrics?.replyRate ?? 0}%`} />
                <StatCard label="Meetings Booked" value={pipelineLoading ? "..." : String(performanceMetrics?.meetingsBooked ?? 0)} />
                <StatCard label="Deals Won" value={pipelineLoading ? "..." : String(performanceMetrics?.dealsWon ?? 0)} />
                <StatCard label="Conversion" value={pipelineLoading ? "..." : `${performanceMetrics?.conversionRate ?? 0}%`} />
              </div>

              {/* Pipeline + Chat layout */}
              <div className="flex-1 flex px-6 pb-6 gap-5 min-h-0" style={{ height: "calc(100vh - 340px)" }}>
                {/* Left: Pipeline Records */}
                <div className="w-[45%] flex flex-col min-h-0">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-white font-bold text-base">Active Pipeline</h3>
                    <span className="text-[#8B8F97] text-xs">{pipelineRecords.length} leads</span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {pipelineLoading ? (
                      <p className="text-[#555A63] text-sm text-center py-8">Loading pipeline...</p>
                    ) : pipelineRecords.length === 0 ? (
                      <p className="text-[#555A63] text-sm text-center py-8">
                        No leads in the pipeline yet. Enable Sales Closer and score leads as hot (70+) to start.
                      </p>
                    ) : (
                      pipelineRecords.map((rec) => (
                        <div
                          key={rec.id}
                          className="w-full text-left p-4 rounded-xl border bg-[#211F1E] border-[#473E38]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-white font-semibold text-sm">{rec.contact_name}</span>
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                                  style={{ background: `${STAGE_COLORS[rec.stage] ?? "#8B8F97"}20`, color: STAGE_COLORS[rec.stage] ?? "#8B8F97" }}
                                >
                                  {formatStage(rec.stage)}
                                </span>
                              </div>
                              <p className="text-[#8B8F97] text-xs">
                                {rec.company_name ?? "No company"} &bull; {rec.emails_sent} sent, {rec.emails_opened} opened, {rec.emails_replied} replied
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {/* Directives indicator */}
                              {rec.directive_count != null && rec.directive_count > 0 && (
                                <DirectivesBadge pipelineId={rec.id} count={rec.directive_count} />
                              )}
                              <button
                                onClick={() => handlePromptPipeline(rec)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2A2A2A] hover:bg-[#353535] border border-[#3A3A3A] rounded-full text-white text-xs font-medium transition-colors"
                                title="Tag this lead into chat"
                              >
                                <Target className="w-3 h-3 text-[#F2903D]" />
                                Tag
                              </button>
                            </div>
                          </div>

                          {/* Pending info request banner */}
                          {rec.pending_requests && rec.pending_requests.length > 0 && (
                            <div className="mt-2 rounded-lg bg-[#7C3AED]/10 border border-[#7C3AED]/30 p-2.5">
                              <div className="flex items-start gap-2">
                                <HelpCircle className="w-3.5 h-3.5 text-[#7C3AED] mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[#7C3AED] text-[10px] font-semibold uppercase mb-0.5">Skyler needs your input</p>
                                  <p className="text-[#E0E0E0] text-xs leading-relaxed">{rec.pending_requests[0].request_description}</p>
                                </div>
                                <button
                                  onClick={() => {
                                    setPinnedContext({
                                      source: "pipeline",
                                      sourceId: rec.id,
                                      contactName: rec.contact_name || rec.contact_email,
                                      companyName: rec.company_name ?? "",
                                      contactEmail: rec.contact_email,
                                      stage: rec.stage,
                                      email: {
                                        role: "skyler",
                                        subject: "Info request",
                                        content: rec.pending_requests![0].request_description,
                                        timestamp: rec.pending_requests![0].created_at,
                                        status: "clarification_needed",
                                      },
                                    });
                                    setTimeout(() => textareaRef.current?.focus(), 50);
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 bg-[#7C3AED]/20 text-[#7C3AED] rounded-md text-[10px] font-medium hover:bg-[#7C3AED]/30 transition-colors flex-shrink-0"
                                >
                                  <CornerUpLeft className="w-3 h-3" />
                                  Respond
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Convo Thread toggle */}
                          {rec.conversation_thread && rec.conversation_thread.length > 0 && (
                            <div className="mt-2">
                              <button
                                onClick={() => setThreadOpenId(threadOpenId === rec.id ? null : rec.id)}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#3A89FF]/10 text-[#3A89FF] rounded-lg text-xs font-medium hover:bg-[#3A89FF]/20 transition-colors"
                              >
                                <MessageSquare className="w-3 h-3" />
                                {threadOpenId === rec.id ? "Hide" : "Convo Thread"} ({rec.conversation_thread.length})
                              </button>

                              {threadOpenId === rec.id && (
                                <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                  {rec.conversation_thread
                                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                                    .map((entry, idx) => {
                                      const isSkyler = entry.role === "skyler";
                                      const displayContent = parseEmailBody(entry.content);
                                      return (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "group/thread rounded-lg p-3 text-xs relative",
                                            isSkyler
                                              ? "bg-[#1A1A1A] border border-[#2A2D35]"
                                              : "bg-[#1A2A1A] border border-[#2A3D2A]"
                                          )}
                                        >
                                          {/* Prompt button — appears on hover */}
                                          <button
                                            onClick={() => {
                                              setPinnedContext({
                                                source: "pipeline",
                                                sourceId: rec.id,
                                                contactName: rec.contact_name || rec.contact_email,
                                                companyName: rec.company_name ?? "",
                                                contactEmail: rec.contact_email,
                                                stage: rec.stage,
                                                email: {
                                                  role: entry.role,
                                                  subject: entry.subject,
                                                  content: entry.content,
                                                  timestamp: entry.timestamp,
                                                  status: entry.status ?? (isSkyler ? "sent" : "received"),
                                                },
                                              });
                                              setTimeout(() => textareaRef.current?.focus(), 50);
                                            }}
                                            className="absolute top-2 right-2 opacity-0 group-hover/thread:opacity-100 p-1 rounded-md bg-white/5 hover:bg-white/10 text-[#8B8F97] hover:text-[#F2903D] transition-all"
                                            title="Give feedback on this email"
                                          >
                                            <CornerUpLeft className="w-3 h-3" />
                                          </button>

                                          <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                              <span className={cn("font-semibold", isSkyler ? "text-[#3A89FF]" : "text-[#4ADE80]")}>
                                                {isSkyler ? "You" : rec.contact_name || rec.contact_email}
                                              </span>
                                              <span
                                                className={cn(
                                                  "px-1.5 py-0.5 rounded text-[9px] font-medium",
                                                  isSkyler ? "bg-[#3A89FF]/15 text-[#3A89FF]" : "bg-[#4ADE80]/15 text-[#4ADE80]"
                                                )}
                                              >
                                                {isSkyler ? "Sent" : "Received"}
                                              </span>
                                            </div>
                                            <span className="text-[#555A63] text-[10px] mr-5">
                                              {new Date(entry.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                                              {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                          </div>
                                          {entry.subject && (
                                            <p className="text-[#8B8F97] text-[10px] mb-1">Subject: {entry.subject}</p>
                                          )}
                                          <p className="text-[#E0E0E0] leading-relaxed whitespace-pre-wrap">{displayContent}</p>
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Meetings Intelligence Panel */}
                          <div className="mt-2">
                            <button
                              onClick={() => setMeetingsOpenId(meetingsOpenId === rec.id ? null : rec.id)}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#06B6D4]/10 text-[#06B6D4] rounded-lg text-xs font-medium hover:bg-[#06B6D4]/20 transition-colors"
                            >
                              <Video className="w-3 h-3" />
                              {meetingsOpenId === rec.id ? "Hide" : "Meetings"}{rec.meeting_count ? ` (${rec.meeting_count})` : ""}
                            </button>

                            {meetingsOpenId === rec.id && (
                              <div className="mt-2">
                                <MeetingsPanel leadId={rec.id} />
                              </div>
                            )}
                          </div>

                          {/* Meeting Outcome + Transcript (legacy) */}
                          {rec.meeting_outcome && !rec.meeting_outcome.error && !meetingsOpenId && (
                            <div className="mt-3">
                              {/* Outcome summary */}
                              <div className="rounded-lg bg-[#1A1A1A] border border-[#2A2D35] p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <FileText className="w-3.5 h-3.5 text-[#06B6D4]" />
                                  <span className="text-[#06B6D4] text-xs font-semibold">Meeting Summary</span>
                                  <span
                                    className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium"
                                    style={{
                                      background: rec.meeting_outcome.outcome === "won" ? "#4ADE8020" : rec.meeting_outcome.outcome === "lost" ? "#F8717120" : "#3A89FF20",
                                      color: rec.meeting_outcome.outcome === "won" ? "#4ADE80" : rec.meeting_outcome.outcome === "lost" ? "#F87171" : "#3A89FF",
                                    }}
                                  >
                                    {rec.meeting_outcome.outcome === "won" ? "Deal Won" : rec.meeting_outcome.outcome === "lost" ? "Deal Lost" : "Follow-up Needed"}
                                  </span>
                                </div>
                                <p className="text-[#E0E0E0] text-xs leading-relaxed mb-2">{rec.meeting_outcome.reasoning}</p>
                                {rec.meeting_outcome.key_discussion_points && rec.meeting_outcome.key_discussion_points.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-[#8B8F97] text-[10px] font-medium uppercase">Key Points</p>
                                    {rec.meeting_outcome.key_discussion_points.map((point, i) => (
                                      <p key={i} className="text-[#E0E0E0] text-xs pl-2 border-l border-[#2A2D35]">{point}</p>
                                    ))}
                                  </div>
                                )}

                                {/* Transcript toggle */}
                                {rec.meeting_transcript && (
                                  <button
                                    onClick={() => setTranscriptOpenId(transcriptOpenId === rec.id ? null : rec.id)}
                                    className="mt-2 flex items-center gap-1.5 px-2.5 py-1 bg-[#06B6D4]/10 text-[#06B6D4] rounded-lg text-xs font-medium hover:bg-[#06B6D4]/20 transition-colors"
                                  >
                                    <FileText className="w-3 h-3" />
                                    {transcriptOpenId === rec.id ? "Hide Transcript" : "View Transcript"}
                                  </button>
                                )}
                                {transcriptOpenId === rec.id && rec.meeting_transcript && (
                                  <div className="mt-2 bg-[#111111] border border-[#2A2D35]/50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                                    <pre className="text-[#E0E0E0] text-xs leading-relaxed whitespace-pre-wrap font-sans">{rec.meeting_transcript}</pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Action Notes */}
                          {rec.action_notes && rec.action_notes.length > 0 && (
                            <div className="mt-3">
                              <div className="rounded-lg bg-[#1A1A1A] border border-[#2A2D35] p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <Clock className="w-3.5 h-3.5 text-[#FBB040]" />
                                  <span className="text-[#FBB040] text-xs font-semibold">Action Notes</span>
                                </div>
                                <div className="space-y-2">
                                  {rec.action_notes.map((note, i) => (
                                    <div
                                      key={i}
                                      className={cn(
                                        "flex items-start gap-2 text-xs p-2 rounded-lg",
                                        note.completed ? "bg-[#4ADE80]/5" : "bg-[#FBB040]/5"
                                      )}
                                    >
                                      {note.completed ? (
                                        <CheckCircle className="w-3.5 h-3.5 text-[#4ADE80] mt-0.5 flex-shrink-0" />
                                      ) : (
                                        <Clock className="w-3.5 h-3.5 text-[#FBB040] mt-0.5 flex-shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className={cn("text-[#E0E0E0]", note.completed && "line-through text-[#8B8F97]")}>{note.task}</p>
                                        {note.deadline && (
                                          <p className="text-[#8B8F97] text-[10px] mt-0.5">
                                            Due: {new Date(note.deadline).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                                          </p>
                                        )}
                                        {note.context && (
                                          <p className="text-[#555A63] text-[10px] mt-0.5">{note.context}</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Skyler Note (proactive intelligence / clarification needed) */}
                          {rec.skyler_note && !rec.skyler_note.resolved && (() => {
                            const noteType = rec.skyler_note.type;
                            const isActionRequired = noteType === "action_required";
                            const isClarification = noteType === "clarification_needed";
                            const NoteIcon = isActionRequired ? AlertTriangle : isClarification ? MessageSquare : Lightbulb;
                            const noteLabel = isActionRequired ? "Action Required" : isClarification ? "Skyler Note" : "Skyler Suggestion";
                            return (
                              <div className="mt-3 rounded-lg bg-[#1A1A1A] border-l-[3px] border-l-[#FBB040] border border-[#2A2D35] p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <NoteIcon className="w-3.5 h-3.5 text-[#FBB040]" />
                                    <span className="text-[#FBB040] text-xs font-semibold">{noteLabel}</span>
                                  </div>
                                  {!isClarification && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          await fetch(`/api/skyler/sales-pipeline/${rec.id}`, {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ dismiss_note: true }),
                                          });
                                          setPipelineRecords((prev) =>
                                            prev.map((r) =>
                                              r.id === rec.id
                                                ? { ...r, skyler_note: { ...r.skyler_note!, resolved: true, resolved_at: new Date().toISOString() } }
                                                : r
                                            )
                                          );
                                        } catch { /* ignore */ }
                                      }}
                                      className="text-[#8B8F97] hover:text-[#E0E0E0] transition-colors"
                                      title="Dismiss"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                                <p className="text-[#E0E0E0] text-xs leading-relaxed mb-3">
                                  {rec.skyler_note.message}
                                </p>
                                {isClarification ? (
                                  <button
                                    onClick={() => {
                                      setPinnedContext({
                                        source: "pipeline",
                                        sourceId: rec.id,
                                        contactName: rec.contact_name || rec.contact_email,
                                        companyName: rec.company_name ?? "",
                                        contactEmail: rec.contact_email,
                                        stage: rec.stage,
                                        email: {
                                          role: "skyler",
                                          subject: "Clarification needed",
                                          content: rec.skyler_note!.message,
                                          timestamp: rec.skyler_note!.created_at,
                                          status: "clarification_needed",
                                        },
                                      });
                                      setTimeout(() => textareaRef.current?.focus(), 50);
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FBB040]/10 text-[#FBB040] rounded-lg text-xs font-medium hover:bg-[#FBB040]/20 transition-colors"
                                  >
                                    <CornerUpLeft className="w-3 h-3" />
                                    Reply to Skyler
                                  </button>
                                ) : (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await fetch(`/api/skyler/sales-pipeline/${rec.id}`, {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ dismiss_note: true }),
                                        });
                                        setPipelineRecords((prev) =>
                                          prev.map((r) =>
                                            r.id === rec.id
                                              ? { ...r, skyler_note: { ...r.skyler_note!, resolved: true, resolved_at: new Date().toISOString() } }
                                              : r
                                          )
                                        );
                                      } catch { /* ignore */ }
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FBB040]/10 text-[#FBB040] rounded-lg text-xs font-medium hover:bg-[#FBB040]/20 transition-colors"
                                  >
                                    <Eye className="w-3 h-3" />
                                    Dismiss
                                  </button>
                                )}
                              </div>
                            );
                          })()}

                          {/* Pending email drafts */}
                          {rec.pending_actions.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {rec.pending_actions.map((pa) => {
                                const isOpen = previewActionId === pa.id;
                                const emailData = pa.tool_input;
                                const isSending = sendingAction === pa.id;
                                const error = sendError[pa.id];
                                return (
                                  <div key={pa.id} className={cn("bg-[#1A1A1A] border rounded-lg overflow-hidden", error ? "border-[#F87171]/40" : "border-[#2A2D35]")}>
                                    {/* Summary row */}
                                    <div className="p-3 flex items-center justify-between gap-2">
                                      <p className="text-[#E0E0E0] text-xs flex-1 min-w-0 truncate">{pa.description}</p>
                                      <button
                                        onClick={() => setPreviewActionId(isOpen ? null : pa.id)}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-[#3A89FF]/15 text-[#3A89FF] rounded-lg text-xs font-medium hover:bg-[#3A89FF]/25 transition-colors flex-shrink-0"
                                      >
                                        <Eye className="w-3 h-3" />
                                        {isOpen ? "Close" : "Preview"}
                                      </button>
                                    </div>

                                    {/* Error banner */}
                                    {error && (
                                      <div className="mx-3 mb-2 px-3 py-2 bg-[#F87171]/10 border border-[#F87171]/30 rounded-lg text-[#F87171] text-xs">
                                        Send failed: {error}
                                      </div>
                                    )}

                                    {/* Expanded email preview */}
                                    {isOpen && emailData && (
                                      <div className="border-t border-[#2A2D35] p-4 space-y-3">
                                        <div className="space-y-1.5">
                                          <div className="flex gap-2 text-xs">
                                            <span className="text-[#8B8F97] w-14 flex-shrink-0">To:</span>
                                            <span className="text-white">{emailData.to}</span>
                                          </div>
                                          <div className="flex gap-2 text-xs">
                                            <span className="text-[#8B8F97] w-14 flex-shrink-0">Subject:</span>
                                            <span className="text-white font-medium">{emailData.subject}</span>
                                          </div>
                                        </div>

                                        {/* Email body */}
                                        <div className="bg-[#111111] border border-[#2A2D35]/50 rounded-lg p-4 max-h-[280px] overflow-y-auto">
                                          {(emailData.htmlBody || emailData.textBody) ? (
                                            <div
                                              className="text-[#E0E0E0] text-sm leading-relaxed [&_a]:text-[#3A89FF] [&_a]:underline [&_p]:mb-2 [&_br]:mb-1"
                                              dangerouslySetInnerHTML={{ __html: unescapeHtml(emailData.htmlBody || emailData.textBody || "") }}
                                            />
                                          ) : (
                                            <p className="text-[#555A63] text-sm italic">No email body</p>
                                          )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 pt-1">
                                          <button
                                            disabled={isSending}
                                            onClick={() => handleApproveDraft(rec.id, pa.id)}
                                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#4ADE80]/20 text-[#4ADE80] rounded-lg text-xs font-medium hover:bg-[#4ADE80]/30 transition-colors disabled:opacity-50"
                                          >
                                            {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                            {isSending ? "Sending..." : error ? "Retry Send" : "Approve and Send"}
                                          </button>
                                          <button
                                            disabled={isSending}
                                            onClick={() => {
                                              handleRejectDraft(rec.id, pa.id, rejectFeedback[pa.id]);
                                              setPreviewActionId(null);
                                              setRejectFeedback((prev) => { const next = { ...prev }; delete next[pa.id]; return next; });
                                            }}
                                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#F87171]/20 text-[#F87171] rounded-lg text-xs font-medium hover:bg-[#F87171]/30 transition-colors disabled:opacity-50"
                                          >
                                            <X className="w-3 h-3" />
                                            Reject
                                          </button>
                                        </div>

                                        {/* Rejection feedback input */}
                                        <input
                                          type="text"
                                          placeholder="Optional: correction feedback (e.g. &quot;be more direct&quot;, &quot;don't mention pricing&quot;)"
                                          value={rejectFeedback[pa.id] ?? ""}
                                          onChange={(e) => setRejectFeedback((prev) => ({ ...prev, [pa.id]: e.target.value }))}
                                          className="w-full bg-[#111111] border border-[#2A2D35]/50 rounded-lg px-3 py-2 text-xs text-white placeholder-[#555A63] outline-none focus:border-[#F87171]/50 transition-colors"
                                        />
                                      </div>
                                    )}

                                    {/* Compact approve/reject when preview is closed */}
                                    {!isOpen && (
                                      <div className="px-3 pb-3 flex gap-2">
                                        <button
                                          disabled={isSending}
                                          onClick={() => handleApproveDraft(rec.id, pa.id)}
                                          className="px-3 py-1 bg-[#4ADE80]/20 text-[#4ADE80] rounded-lg text-xs font-medium hover:bg-[#4ADE80]/30 transition-colors disabled:opacity-50"
                                        >
                                          {isSending ? "Sending..." : error ? "Retry Send" : "Approve and Send"}
                                        </button>
                                        <button
                                          disabled={isSending}
                                          onClick={() => handleRejectDraft(rec.id, pa.id)}
                                          className="px-3 py-1 bg-[#F87171]/20 text-[#F87171] rounded-lg text-xs font-medium hover:bg-[#F87171]/30 transition-colors disabled:opacity-50"
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Right: Chat with Skyler (same as Lead Qual) */}
                <div className="flex-1 flex flex-col min-h-0 bg-black rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2520]">
                    <h3 className="text-white font-bold text-base">Chat with Skyler</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto px-5 py-4">
                    {!hasChatContent ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={64} height={64} className="rounded-full mx-auto mb-4 opacity-40 object-cover aspect-square" />
                          <p className="text-[#555A63] text-sm">Ask Skyler about outreach, pipeline progress, or performance.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {chatMessages.map((msg) => {
                          const actions = messageActions[msg.id] ?? [];
                          return (
                            <div key={msg.id}>
                              <div className={cn("flex gap-3 items-start", msg.role === "user" ? "justify-end" : "")}>
                                {msg.role === "assistant" && (
                                  <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                                    <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={28} height={28} className="w-full h-full object-cover" />
                                  </div>
                                )}
                                <div className={cn("rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%]", msg.role === "user" ? "bg-[#F2903D]/20 text-white" : "bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]")}>
                                  {msg.role === "user" && msg.highlight && <HighlightQuote highlight={msg.highlight} />}
                                  {msg.role === "assistant" ? <MarkdownRenderer content={msg.content} /> : <div className="whitespace-pre-wrap">{msg.content}</div>}
                                </div>
                              </div>
                              {actions.length > 0 && (
                                <div className="ml-10 mt-2 space-y-2">
                                  {actions.map((pa) => (
                                    <ActionApproval key={pa.id} actionId={pa.id} description={pa.description} workspaceId={workspaceId} />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {(streamingContent || activityLabel) && (
                          <div className="flex gap-3 items-start">
                            <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
                              <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={28} height={28} className="w-full h-full object-cover" />
                            </div>
                            <div className="rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] bg-[#1A1714] border border-[#2A2520] text-[#E0E0E0]">
                              {streamingContent ? <MarkdownRenderer content={streamingContent} /> : (
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
                  {/* Input bar */}
                  <div className="px-4 pb-4">
                    {/* Pinned context card (reply-to-email) */}
                    {pinnedContext && (
                      <div className="mb-2 rounded-lg bg-[#1a1d21] border-l-[3px] border-l-[#F2903D] px-3 py-2.5 flex items-start gap-2">
                        <Target className="w-3.5 h-3.5 text-[#F2903D] flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[#F2903D] text-xs font-semibold truncate">
                            {pinnedContext.contactName}{pinnedContext.companyName ? ` · ${pinnedContext.companyName}` : ""}
                          </p>
                          <p className="text-[#8B8F97] text-[11px] truncate mt-0.5">
                            {pinnedContext.email
                              ? `${pinnedContext.email.subject ? `"${pinnedContext.email.subject}" — ` : ""}${parseEmailBody(pinnedContext.email.content).slice(0, 60)}${pinnedContext.email.content.length > 60 ? "..." : ""}`
                              : `${pinnedContext.stage ? formatStage(pinnedContext.stage) + " · " : ""}${pinnedContext.contactEmail ?? "Tagged lead"}`}
                          </p>
                        </div>
                        <button
                          onClick={() => setPinnedContext(null)}
                          className="text-[#555A63] hover:text-white transition-colors flex-shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-end gap-2 bg-[#2B2B2B] rounded-2xl px-4 py-3 focus-within:ring-1 focus-within:ring-[#F2903D]/50 transition-all">
                      <textarea
                        value={inputValue}
                        onChange={(e) => { setInputValue(e.target.value); resizeTextarea(e.target); }}
                        onKeyDown={handleKeyDown}
                        placeholder={pinnedContext ? `Message Skyler about ${pinnedContext.contactName}...` : "Ask Skyler about outreach..."}
                        rows={1}
                        disabled={isStreaming}
                        className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed disabled:opacity-50"
                        style={{ maxHeight: "160px", overflowY: "auto" }}
                      />
                      <button type="button" onClick={() => { void handleSendMessage(); }} className="flex-shrink-0 pb-0.5 cursor-pointer" aria-label="Send message">
                        <Image src="/cleverbrain-chat-icons/send-prompt-icon.png" alt="Send" width={24} height={24} className={cn("transition-opacity pointer-events-none", inputValue.trim() && !isStreaming ? "opacity-100" : "opacity-40")} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Workflow Settings Tab ────────────────────────────────── */}
          {activeTab === "workflows-settings" && (
            <div className="p-6">
              <WorkflowSettings workspaceId={workspaceId} />
            </div>
          )}

          {/* ── Lead Qualification Tab (default) ─────────────────────── */}
          {activeTab !== "sales-closer" && activeTab !== "workflows-settings" && (
          <>
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
                      const actions = messageActions[msg.id] ?? [];

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
                              {msg.role === "user" && msg.highlight && <HighlightQuote highlight={msg.highlight} />}
                              {msg.role === "assistant" ? (
                                <MarkdownRenderer content={msg.content} />
                              ) : (
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                              )}
                            </div>
                          </div>
                          {actions.length > 0 && (
                            <div className="ml-10 mt-2 space-y-2">
                              {actions.map((pa) => (
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
                {/* Pinned context card (tagged lead) */}
                {pinnedContext && (
                  <div className="mb-2 rounded-lg bg-[#1a1d21] border-l-[3px] border-l-[#F2903D] px-3 py-2.5 flex items-start gap-2">
                    <Target className="w-3.5 h-3.5 text-[#F2903D] flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[#F2903D] text-xs font-semibold truncate">
                        {pinnedContext.contactName}{pinnedContext.companyName ? ` · ${pinnedContext.companyName}` : ""}
                      </p>
                      <p className="text-[#8B8F97] text-[11px] truncate mt-0.5">
                        {pinnedContext.email
                          ? `${pinnedContext.email.subject ? `"${pinnedContext.email.subject}" — ` : ""}${parseEmailBody(pinnedContext.email.content).slice(0, 60)}${pinnedContext.email.content.length > 60 ? "..." : ""}`
                          : `${pinnedContext.stage ? formatStage(pinnedContext.stage) + " · " : ""}${pinnedContext.contactEmail ?? "Tagged lead"}`}
                      </p>
                    </div>
                    <button
                      onClick={() => setPinnedContext(null)}
                      className="text-[#555A63] hover:text-white transition-colors flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
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
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      resizeTextarea(e.target);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={pinnedContext ? `Message Skyler about ${pinnedContext.contactName}...` : "Ask Skyler about your pipeline..."}
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
          </>
          )}
        </div>
      </div>

      {/* ── Right Icon Bar ────────────────────────────────────────────── */}
      <SkylerRightIconBar />
    </div>
  );
}

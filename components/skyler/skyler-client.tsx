"use client";

import { useState, useRef } from "react";
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
  Mail,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkflowTab = "lead-qualification" | "prospect-engagement" | "sales-closer" | "workflows-settings";

type LeadPriority = "High" | "Medium" | "Low";

type Lead = {
  id: string;
  company: string;
  priority: LeadPriority;
  potential: string;
  detail: string;
};

type EmailMessage = {
  id: string;
  senderName: string;
  senderEmail: string;
  timestamp: string;
  subject: string;
  body: string;
};

type LeadFilter = "all" | "hot" | "nurture" | "disqualified";

// ── Placeholder Data ─────────────────────────────────────────────────────────

const PLACEHOLDER_LEADS: Lead[] = [
  { id: "1", company: "TechStartup Inc.", priority: "High", potential: "$50K+", detail: "Decision maker identified" },
  { id: "2", company: "GlobalTech Corp.", priority: "Medium", potential: "$35K+", detail: "Decision maker identified" },
  { id: "3", company: "InnovateSoft Ltd.", priority: "High", potential: "$80K+", detail: "Decision maker identified" },
  { id: "4", company: "DataFlow Systems", priority: "High", potential: "$45K+", detail: "Decision maker identified" },
  { id: "5", company: "CloudNine Solutions", priority: "High", potential: "$60K+", detail: "Decision maker identified" },
  { id: "6", company: "NextGen AI Corp.", priority: "High", potential: "$120K+", detail: "Decision maker identified" },
  { id: "7", company: "Quantum Analytics", priority: "High", potential: "$55K+", detail: "Decision maker identified" },
];

const PLACEHOLDER_EMAILS: EmailMessage[] = [
  {
    id: "e1",
    senderName: "You (Via Skyler)",
    senderEmail: "your.name@yourcompany.com",
    timestamp: "Feb 9, 2026 at 10:15 AM",
    subject: "Re: TechCorp Enterprise Pricing - Quick Demo?",
    body: "Hi Sarah,\n\nI noticed visited our enterprise pricing this week. Given TechCorp's use of Salesforce, I thought you'd be interested in our new native integration that just launched.\n\nOur customers in the 200-500 employee range typically see 40% faster deal cycles after implementation. Would a 15-minute demo focused specifically on the Salesforce workflow be valuable?\n\nBest regards,\n[Your Name]",
  },
  {
    id: "e2",
    senderName: "You (Via Skyler)",
    senderEmail: "your.name@yourcompany.com",
    timestamp: "Feb 9, 2026 at 10:15 AM",
    subject: "Re: TechCorp Enterprise Pricing - Quick Demo?",
    body: "Hi Sarah,\n\nJust following up on my previous message. I'd love to schedule a quick call to discuss how we can help TechCorp streamline your sales workflow.\n\nBest regards,\n[Your Name]",
  },
];

const QUICK_ACTIONS = [
  "Draft a follow up message",
  "Recommendation",
  "Skyler's AI Analysis",
  "Draft a follow up message",
];

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

// ── Email Thread View ────────────────────────────────────────────────────────

function EmailThreadView({ emails, lead }: { emails: EmailMessage[]; lead: Lead }) {
  return (
    <div className="flex flex-col h-full">
      {/* Email thread container */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-[#1A1714] border border-[#2A2520] rounded-xl overflow-hidden">
          {/* Thread header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2520]">
            <span className="text-[#8B8F97] text-sm font-medium">Email Thread</span>
            <span className="text-[#8B8F97] text-sm">{emails.length} messages</span>
          </div>

          {/* Messages */}
          <div className="divide-y divide-[#2A2520]">
            {emails.map((email, idx) => (
              <div key={email.id} className="px-5 py-5 relative group">
                {/* Sender row */}
                <div className="flex items-start gap-3 mb-3">
                  <Image
                    src="/skyler-icons/skyler-avatar.png"
                    alt="Skyler"
                    width={40}
                    height={40}
                    className="rounded-full flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-semibold text-sm">{email.senderName}</p>
                      <p className="text-[#8B8F97] text-xs flex-shrink-0">{email.timestamp}</p>
                    </div>
                    <p className="text-[#8B8F97] text-xs">{email.senderEmail}</p>
                  </div>
                </div>

                {/* Subject */}
                <p className="text-[#F2903D] font-semibold text-sm mb-3">{email.subject}</p>

                {/* Body */}
                <div className="text-[#E0E0E0] text-sm leading-relaxed whitespace-pre-line">
                  {email.body}
                </div>

                {/* Draft reply button on hover / last message */}
                {idx === emails.length - 1 && (
                  <button className="mt-3 px-3 py-1.5 bg-[#2A2A2A] hover:bg-[#353535] border border-[#3A3A3A] rounded-lg text-[#8B8F97] text-xs transition-colors">
                    Draft a reply
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Right Icon Bar ───────────────────────────────────────────────────────────

function SkylerRightIconBar() {
  return (
    <div className="w-[76px] bg-[#1B1B1B] border-l border-[#2A2D35]/60 flex flex-col items-center justify-center flex-shrink-0">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#2A2D35]/60 px-3 py-5" style={{ background: "#1F1F1FCC" }}>
        {/* CleverBrain chat */}
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png" alt="CleverBrain" width={36} height={36} />
        </Link>

        {/* Skyler — active */}
        <Link href="/skyler" title="Skyler" className="opacity-100 ring-2 ring-[#F2903D]/40 rounded-lg transition-opacity">
          <Image src="/cleverbrain-chat-icons/skyler-icon.png" alt="Skyler" width={36} height={36} className="rounded-full" />
        </Link>

        {/* Connectors */}
        <Link href="/cleverbrain" title="Connectors" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/conectors-icon.png" alt="Connectors" width={34} height={34} />
        </Link>

        {/* AI Employee */}
        <Link href="/cleverbrain" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/hire-ai-employee-icon.png" alt="AI Employees" width={34} height={34} />
        </Link>

        {/* Organization */}
        <Link href="/settings" title="Organization" className="hover:opacity-80 transition-opacity">
          <Image src="/cleverbrain-chat-icons/organization-icon.png" alt="Organization" width={36} height={36} />
        </Link>
      </div>
    </div>
  );
}

// ── Workflow Nav Item ─────────────────────────────────────────────────────────

const WORKFLOW_TABS: { id: WorkflowTab; label: string; icon: typeof Zap }[] = [
  { id: "lead-qualification", label: "Lead Qualification", icon: Zap },
  { id: "prospect-engagement", label: "Prospect Engagement", icon: Users },
  { id: "sales-closer", label: "Sales Closer", icon: Target },
  { id: "workflows-settings", label: "Workflows Settings", icon: Settings },
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
  const [salesCloserEnabled, setSalesCloserEnabled] = useState(true);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [inputValue, setInputValue] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeLead = PLACEHOLDER_LEADS.find((l) => l.id === activeLeadId) ?? null;

  function handlePrompt(company: string) {
    setInputValue(`Tell me about ${company}`);
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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#1B1B1B]">
      {/* ── Left Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden bg-[#1B1B1B]",
          sidebarCollapsed ? "w-0" : "w-[240px]"
        )}
      >
        {/* Collapse button */}
        <div className="flex items-center justify-end px-3 pt-3 pb-1">
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="text-[#8B8F97] hover:text-white transition-colors"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* Skyler avatar */}
        <div className="flex flex-col items-center px-4 pt-2 pb-4">
          <div className="w-[140px] h-[140px] rounded-full overflow-hidden mb-3">
            <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={140} height={140} />
          </div>
          <h2 className="text-white font-bold text-lg">Skyler</h2>
          <p className="text-[#8B8F97] text-sm mt-0.5">Sales Representative</p>

          {/* New chat button */}
          <button className="mt-4 w-full h-[38px] rounded-full flex items-center justify-center gap-2 text-white text-sm font-medium bg-[#2A2A2A] border border-[#3A3A3A] hover:bg-[#353535] transition-colors">
            <span className="text-lg leading-none">+</span>
            Start new chat
          </button>
        </div>

        {/* Workflow nav */}
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
              <p className="px-3 py-4 text-xs text-[#555A63] text-center">
                No conversations yet
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="h-[60px] flex items-center justify-between px-6 flex-shrink-0 border-b border-[#2A2D35]/40 bg-[#1B1B1B]">
          {/* Left: collapse toggle + badges */}
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
            {/* Cleverfolks logo */}
            <Image
              src="/cleverbrain-chat-icons/cleverfolks-logo.png"
              alt="Cleverfolks"
              width={120}
              height={24}
              className="brightness-0 invert"
            />
          </div>

          {/* Right: 156K badge, bell, user */}
          <div className="flex items-center gap-4">
            {/* 156K badge */}
            <div className="w-10 h-10 rounded-full border-2 border-[#4ADE80] flex items-center justify-center">
              <span className="text-[#4ADE80] text-[10px] font-bold">156K</span>
            </div>

            {/* Bell */}
            <div className="relative">
              <Bell className="w-5 h-5 text-[#8B8F97]" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#3A89FF] rounded-full text-[9px] text-white flex items-center justify-center font-bold">3</span>
            </div>

            {/* User avatar */}
            <Image
              src="/cleverbrain-chat-icons/organization-dp.png"
              alt="User"
              width={32}
              height={32}
              className="rounded-full"
            />

            {/* User name + dropdown */}
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
              {/* Connected integrations icons */}
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#FCB045] flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">IG</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-[#0F9D58] flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">GD</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-[#FF7A59] flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">HS</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Stats Cards */}
          <div className="px-6 py-4 flex gap-4">
            <StatCard label="Qualification Rate" value="35%" />
            <StatCard label="Hot Leads" value="2" />
            <StatCard label="Nurture Queue" value="12" />
            <StatCard label="Disqualified" value="12" />
          </div>

          {/* Section 3: Sales Closer Permission Bar */}
          <div className="mx-6 mb-4 bg-[#1F1F1F] border border-[#2A2D35]/40 rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <span className="text-white font-semibold text-sm">Sales Closer</span>
              <span className="text-[#8B8F97] text-sm ml-2">
                Skyler takes over the conversation handling questions, addressing objections, and booking demos.
              </span>
            </div>
            <ToggleSwitch enabled={salesCloserEnabled} onToggle={() => setSalesCloserEnabled((v) => !v)} />
          </div>

          {/* Section 4: Two-column layout */}
          <div className="flex-1 flex px-6 pb-6 gap-5 min-h-0" style={{ height: "calc(100vh - 340px)" }}>
            {/* Left: Hot Leads */}
            <div className="w-[45%] flex flex-col min-h-0">
              {/* Header */}
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

              {/* Tab filters */}
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

              {/* Lead cards */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {PLACEHOLDER_LEADS.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    isActive={lead.id === activeLeadId}
                    onClick={() => setActiveLeadId(lead.id)}
                    onPrompt={() => handlePrompt(lead.company)}
                  />
                ))}
              </div>
            </div>

            {/* Right: Chat with Skyler */}
            <div className="flex-1 flex flex-col min-h-0 bg-black rounded-xl overflow-hidden">
              {/* Chat header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2520]">
                <h3 className="text-white font-bold text-base">Chat with Skyler</h3>
                <div className="flex items-center gap-2">
                  {activeLead && (
                    <button className="flex items-center gap-1.5 text-[#8B8F97] text-xs hover:text-white transition-colors">
                      <Mail className="w-3.5 h-3.5" />
                      Email Thread
                    </button>
                  )}
                  <button className="text-[#8B8F97] text-sm underline underline-offset-2 hover:text-white transition-colors">
                    Go to chat
                  </button>
                </div>
              </div>

              {/* Chat content */}
              <div className="flex-1 overflow-hidden">
                {activeLead ? (
                  <EmailThreadView emails={PLACEHOLDER_EMAILS} lead={activeLead} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-[#555A63] text-sm">Select a lead to Prompt</p>
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="px-4 pb-2">
                <div className="flex flex-wrap gap-2 mb-3">
                  {QUICK_ACTIONS.map((action, i) => (
                    <button
                      key={i}
                      className="px-3 py-1.5 bg-[#1A1A1A] border border-[#2A2D35] rounded-full text-[#8B8F97] text-xs hover:text-white hover:border-[#3A3D45] transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input bar */}
              <div className="px-4 pb-4">
                <div className="flex items-end gap-2 bg-[#2B2B2B] rounded-2xl px-4 py-3 focus-within:ring-1 focus-within:ring-[#F2903D]/50 transition-all">
                  <button className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                    <Image
                      src="/cleverbrain-chat-icons/add-media-icon.png"
                      alt="Attach"
                      width={20}
                      height={20}
                      className="opacity-60 hover:opacity-100"
                    />
                  </button>
                  <button className="flex-shrink-0 text-[#8B8F97] hover:text-white transition-colors pb-0.5">
                    <Mic className="w-5 h-5" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      resizeTextarea(e.target);
                    }}
                    placeholder="Type a message here"
                    rows={1}
                    className="flex-1 bg-transparent text-white placeholder-[#555A63] text-sm resize-none outline-none leading-relaxed"
                    style={{ maxHeight: "160px", overflowY: "auto" }}
                  />
                  <button className="flex-shrink-0 pb-0.5" aria-label="Send message">
                    <Image
                      src="/cleverbrain-chat-icons/send-prompt-icon.png"
                      alt="Send"
                      width={24}
                      height={24}
                      className={cn("transition-opacity", inputValue.trim() ? "opacity-100" : "opacity-40")}
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

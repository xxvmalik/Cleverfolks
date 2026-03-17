"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Zap, PenLine, Loader2, Pencil, Check, X, Plus, Trash2, AlertTriangle, Flame, Sprout, Archive, ChevronDown, Search, Hash, User, Video, Calendar, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type SlackTarget = {
  id: string;
  name: string;
  type: "channel" | "member";
};

type ScoringDimension = {
  name: string;
  weight: number;
  description: string;
};

type RoutingRule = {
  label: string;
  minScore: number;
  maxScore: number;
  description: string;
};

type WorkflowSettings = {
  autonomyLevel: "full_autonomy" | "draft_approve";
  scoringDimensions: ScoringDimension[];
  routingRules: RoutingRule[];
  notifications: {
    slack: boolean;
    slackChannel: string;
    slackChannels: SlackTarget[];
    email: boolean;
    emailAddress: string;
    emailAddresses: string[];
    taskCreation: boolean;
    taskAssignee: string;
  };
  escalationRules: {
    dealValueExceedsThreshold: boolean;
    dealValueThreshold: number;
    vipAccount: boolean;
    negativeSentiment: boolean;
    firstContact: boolean;
    cSuiteContact: boolean;
    pricingNegotiation: boolean;
  };
  primaryGoal: string;
  salesJourney: string;
  pricingStructure: string;
  averageSalesCycle: string;
  averageDealSize: string;
  formality: string;
  communicationApproach: string;
  phrasesToAlwaysUse: string[];
  phrasesToNeverUse: string[];
  maxFollowUpAttempts: number;
  bookDemosUsing: string;
  autonomyToggles: {
    sendFollowUps: boolean;
    handleObjections: boolean;
    bookMeetings: boolean;
    firstOutreachApproval: boolean;
  };
  knowledgeGapHandling: "ask_first" | "draft_best_attempt";
};

type MeetingSettings = {
  autoJoinMeetings: boolean;
  botDisplayName: string;
  calendarConnected: boolean;
  calendarProvider: string;
  calendarEmail: string;
};

type SettingsTab = "global-rules" | "lead-qualification" | "sales-closer" | "meetings";

// ── Colours for weight distribution bar segments ────────────────────────────

const DIMENSION_COLORS = [
  "#F2903D", // orange
  "#3A89FF", // blue
  "#4ADE80", // green
  "#7C3AED", // purple
  "#FB923C", // amber
  "#F87171", // red
  "#38BDF8", // sky
  "#FACC15", // yellow
];

// ── Reusable Sub-components ─────────────────────────────────────────────────

function SettingsToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-[44px] h-[24px] rounded-full relative transition-colors flex-shrink-0",
        "bg-[#545454]"
      )}
    >
      <div
        className={cn(
          "w-[18px] h-[18px] rounded-full absolute top-[3px] transition-all",
          enabled ? "left-[23px] bg-[#F2903D]" : "left-[3px] bg-[#8B8F97]"
        )}
      />
    </button>
  );
}

function AutonomyCard({
  icon: Icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: typeof Zap;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-xl p-5 text-left transition-all border",
        active
          ? "bg-[#1A1714] border-[#F2903D]/50"
          : "bg-[#1C1F24] border-[#2A2D35] hover:border-[#3A3D45]"
      )}
    >
      <Icon className={cn("w-5 h-5 mb-3", active ? "text-[#F2903D]" : "text-[#8B8F97]")} />
      <h4 className={cn("font-semibold text-sm mb-1", active ? "text-white" : "text-[#8B8F97]")}>
        {label}
      </h4>
      <p className="text-[#555A63] text-xs leading-relaxed">{description}</p>
    </button>
  );
}

function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border",
            value === opt
              ? "bg-[#F2903D]/15 border-[#F2903D]/50 text-[#F2903D]"
              : "bg-[#1C1F24] border-[#2A2D35] text-[#8B8F97] hover:text-white hover:border-[#3A3D45]"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function TagInput({
  tags,
  onChange,
  placeholder,
  color = "default",
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  color?: "default" | "green" | "red";
}) {
  const [inputVal, setInputVal] = useState("");

  const colorMap = {
    default: { bg: "bg-white/5", border: "border-[#2A2D35]", text: "text-[#E0E0E0]" },
    green: { bg: "bg-[#4ADE80]/10", border: "border-[#4ADE80]/20", text: "text-[#4ADE80]" },
    red: { bg: "bg-[#F87171]/10", border: "border-[#F87171]/20", text: "text-[#F87171]" },
  }[color];

  function addTag() {
    const val = inputVal.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
      setInputVal("");
    }
  }

  return (
    <div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag, i) => (
            <span
              key={i}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border",
                colorMap.bg, colorMap.border, colorMap.text
              )}
            >
              {tag}
              <button
                onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                className="hover:opacity-70"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          className="bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 flex-1 max-w-[320px]"
        />
        <button
          onClick={addTag}
          className="px-3 py-1.5 bg-white/5 text-[#8B8F97] rounded-lg text-xs font-medium hover:bg-white/10 hover:text-white transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/** Weight distribution bar — coloured segments proportional to scoring dimension weights */
function WeightDistributionBar({ dimensions }: { dimensions: ScoringDimension[] }) {
  const total = dimensions.reduce((s, d) => s + d.weight, 0);
  if (total === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex h-3 rounded-full overflow-hidden bg-[#2A2D35]">
        {dimensions.map((dim, i) => {
          const pct = (dim.weight / total) * 100;
          return (
            <div
              key={i}
              style={{ width: `${pct}%`, backgroundColor: DIMENSION_COLORS[i % DIMENSION_COLORS.length] }}
              className="transition-all duration-300"
              title={`${dim.name}: ${dim.weight}%`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {dimensions.map((dim, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: DIMENSION_COLORS[i % DIMENSION_COLORS.length] }}
            />
            <span className="text-[#8B8F97] text-[11px]">{dim.name} ({dim.weight}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Routing card config ─────────────────────────────────────────────────────

const ROUTING_CARD_CONFIG: Record<string, {
  icon: typeof Flame;
  bgTint: string;
  borderTint: string;
  iconColor: string;
  labelColor: string;
}> = {
  "Hot Lead": {
    icon: Flame,
    bgTint: "bg-[#4ADE80]/5",
    borderTint: "border-[#4ADE80]/20",
    iconColor: "text-[#4ADE80]",
    labelColor: "text-[#4ADE80]",
  },
  "Nurture": {
    icon: Sprout,
    bgTint: "bg-[#FB923C]/5",
    borderTint: "border-[#FB923C]/20",
    iconColor: "text-[#FB923C]",
    labelColor: "text-[#FB923C]",
  },
  "Low Priority": {
    icon: Archive,
    bgTint: "bg-[#8B8F97]/5",
    borderTint: "border-[#8B8F97]/20",
    iconColor: "text-[#8B8F97]",
    labelColor: "text-[#8B8F97]",
  },
};

// ── Slack Picker ────────────────────────────────────────────────────────────

type SlackOption = { id: string; name: string; type: "channel" | "member" };

function SlackMultiPicker({
  selected,
  onChange,
  options,
  loadingOptions,
  max = 3,
}: {
  selected: SlackTarget[];
  onChange: (v: SlackTarget[]) => void;
  options: SlackOption[];
  loadingOptions: boolean;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedIds = new Set(selected.map((s) => s.id));
  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) && !selectedIds.has(o.id)
  );

  return (
    <div ref={ref} className="relative">
      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((target) => (
            <span
              key={target.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border bg-[#F2903D]/10 border-[#F2903D]/30 text-[#F2903D]"
            >
              {target.type === "channel" ? <Hash className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {target.name}
              <button onClick={() => onChange(selected.filter((s) => s.id !== target.id))} className="hover:opacity-70">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger button */}
      {selected.length < max && (
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-xs text-[#8B8F97] hover:border-[#F2903D]/50 transition-colors w-[260px]"
        >
          <Search className="w-3 h-3" />
          <span>
            {loadingOptions ? "Loading Slack..." : `Select channel or member (${selected.length}/${max})`}
          </span>
          <ChevronDown className="w-3 h-3 ml-auto" />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-[280px] bg-[#1C1F24] border border-[#2A2D35] rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-[#2A2D35]">
            <input
              type="text"
              placeholder="Search channels or members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-xs text-white placeholder-[#555A63] outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto thin-scrollbar">
            {loadingOptions ? (
              <div className="px-3 py-4 text-center text-xs text-[#8B8F97]">
                <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
                Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[#555A63]">
                {options.length === 0 ? "Connect Slack to see options" : "No matches found"}
              </div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onChange([...selected, { id: opt.id, name: opt.name, type: opt.type }]);
                    setSearch("");
                    if (selected.length + 1 >= max) setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#E0E0E0] hover:bg-white/5 transition-colors"
                >
                  {opt.type === "channel" ? (
                    <Hash className="w-3.5 h-3.5 text-[#8B8F97]" />
                  ) : (
                    <User className="w-3.5 h-3.5 text-[#8B8F97]" />
                  )}
                  {opt.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Email Multi Input ───────────────────────────────────────────────────────

function EmailMultiInput({
  emails,
  onChange,
  max = 3,
}: {
  emails: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const [inputVal, setInputVal] = useState("");

  function addEmail() {
    const val = inputVal.trim().toLowerCase();
    if (val && val.includes("@") && !emails.includes(val) && emails.length < max) {
      onChange([...emails, val]);
      setInputVal("");
    }
  }

  return (
    <div>
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {emails.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border bg-white/5 border-[#2A2D35] text-[#E0E0E0]"
            >
              {email}
              <button onClick={() => onChange(emails.filter((e) => e !== email))} className="hover:opacity-70">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {emails.length < max && (
        <div className="flex gap-2">
          <input
            type="email"
            placeholder={emails.length === 0 ? "sales@company.com" : "Add another email..."}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
            className="bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 w-[220px]"
          />
          <button
            onClick={addEmail}
            className="px-3 py-1.5 bg-white/5 text-[#8B8F97] rounded-lg text-xs font-medium hover:bg-white/10 hover:text-white transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function WorkflowSettings({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<WorkflowSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("global-rules");
  const [meetingSettings, setMeetingSettings] = useState<MeetingSettings>({
    autoJoinMeetings: false,
    botDisplayName: "",
    calendarConnected: false,
    calendarProvider: "",
    calendarEmail: "",
  });
  const [slackOptions, setSlackOptions] = useState<SlackOption[]>([]);
  const [slackLoading, setSlackLoading] = useState(false);
  const [editingDimension, setEditingDimension] = useState<number | null>(null);
  const [editDimensionValues, setEditDimensionValues] = useState<ScoringDimension | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/skyler/workflow-settings?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        if (data.meetingSettings) {
          setMeetingSettings((prev) => ({ ...prev, ...data.meetingSettings }));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Fetch Slack channels + members
  useEffect(() => {
    async function fetchSlackOptions() {
      setSlackLoading(true);
      try {
        const res = await fetch(`/api/skyler/slack-options?workspaceId=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          setSlackOptions([...(data.channels ?? []), ...(data.members ?? [])]);
        }
      } catch {
        // Slack may not be connected — that's fine
      } finally {
        setSlackLoading(false);
      }
    }
    fetchSlackOptions();
  }, [workspaceId]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function updateSettings(partial: Partial<WorkflowSettings>) {
    if (!settings) return;
    setSettings({ ...settings, ...partial });
    markDirty();
  }

  function updateNotification(key: string, value: unknown) {
    if (!settings) return;
    setSettings({ ...settings, notifications: { ...settings.notifications, [key]: value } });
    markDirty();
  }

  function updateEscalation(key: string, value: unknown) {
    if (!settings) return;
    setSettings({ ...settings, escalationRules: { ...settings.escalationRules, [key]: value } });
    markDirty();
  }

  function updateAutonomyToggle(key: keyof WorkflowSettings["autonomyToggles"], value: boolean) {
    if (!settings) return;
    setSettings({ ...settings, autonomyToggles: { ...settings.autonomyToggles, [key]: value } });
    markDirty();
  }

  function updateDimension(index: number, dim: ScoringDimension) {
    if (!settings) return;
    const dims = [...settings.scoringDimensions];
    dims[index] = dim;
    setSettings({ ...settings, scoringDimensions: dims });
    markDirty();
  }

  function addDimension() {
    if (!settings) return;
    const dims = [...settings.scoringDimensions, { name: "New Dimension", weight: 10, description: "Description here." }];
    setSettings({ ...settings, scoringDimensions: dims });
    markDirty();
    setEditingDimension(dims.length - 1);
    setEditDimensionValues(dims[dims.length - 1]);
  }

  function removeDimension(index: number) {
    if (!settings) return;
    const dims = settings.scoringDimensions.filter((_, i) => i !== index);
    setSettings({ ...settings, scoringDimensions: dims });
    markDirty();
  }

  /** Update a routing rule boundary and auto-adjust adjacent rules to stay contiguous */
  function updateRoutingBoundary(ruleIndex: number, field: "minScore" | "maxScore", value: number) {
    if (!settings) return;
    const rules = [...settings.routingRules];
    // Sort by minScore descending (Hot Lead first, Low Priority last)
    rules.sort((a, b) => b.minScore - a.minScore);

    const clamped = Math.max(0, Math.min(100, value));
    rules[ruleIndex] = { ...rules[ruleIndex], [field]: clamped };

    // Auto-adjust: make adjacent ranges contiguous
    // Rules are sorted: [Hot (highest), Nurture (mid), Low (lowest)]
    for (let i = 0; i < rules.length - 1; i++) {
      // The next rule's maxScore = current rule's minScore - 1
      rules[i + 1] = { ...rules[i + 1], maxScore: rules[i].minScore - 1 };
    }
    // First rule always ends at 100
    rules[0] = { ...rules[0], maxScore: 100 };
    // Last rule always starts at 0
    rules[rules.length - 1] = { ...rules[rules.length - 1], minScore: 0 };

    setSettings({ ...settings, routingRules: rules });
    markDirty();
  }

  function updateMeetingSetting<K extends keyof MeetingSettings>(key: K, value: MeetingSettings[K]) {
    setMeetingSettings((prev) => ({ ...prev, [key]: value }));
    markDirty();
  }

  async function handleSave() {
    if (!settings || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/skyler/workflow-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, settings, meetingSettings }),
      });
      if (res.ok) {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[#8B8F97]" />
      </div>
    );
  }

  if (!settings) return null;

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "global-rules", label: "Global Rules" },
    { id: "lead-qualification", label: "Lead Qualification" },
    { id: "sales-closer", label: "Sales Closer" },
    { id: "meetings", label: "Meeting Intelligence" },
  ];

  // Sort routing rules by minScore descending for display
  const sortedRoutingRules = [...settings.routingRules].sort((a, b) => b.minScore - a.minScore);

  return (
    <div className="max-w-[900px] mx-auto">
      {/* Header */}
      <div className="bg-[#111111] px-8 py-6 border-b border-[#2A2D35]/30 rounded-t-xl">
        <h2 className="text-white font-bold text-lg">SKYLER Workflow - Settings</h2>
        <p className="text-[#8B8F97] text-sm mt-1">
          Control how much autonomy SKYLER has. You&apos;re always in charge.
        </p>
      </div>

      <div className="px-8 py-6 space-y-8">
        {/* ── Global Autonomy Level ─────────────────────────────────────── */}
        <div>
          <h3 className="text-white font-semibold text-base mb-1">Global Autonomy Level</h3>
          <p className="text-[#8B8F97] text-xs mb-4">
            Set the default permission level for all SKYLER actions.
          </p>
          <div className="flex gap-3">
            <AutonomyCard
              icon={Zap}
              label="Full Autonomy"
              description="SKYLER takes actions and reports updates after"
              active={settings.autonomyLevel === "full_autonomy"}
              onClick={() => updateSettings({ autonomyLevel: "full_autonomy" })}
            />
            <AutonomyCard
              icon={PenLine}
              label="Draft & Approve"
              description="SKYLER drafts actions, you review and approve"
              active={settings.autonomyLevel === "draft_approve"}
              onClick={() => updateSettings({ autonomyLevel: "draft_approve" })}
            />
          </div>
        </div>

        {/* ── Sub-tabs ─────────────────────────────────────────────────── */}
        <div className="flex gap-6 border-b border-[#2A2D35]/40">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-3 text-sm transition-colors",
                activeTab === tab.id
                  ? "text-white border-b-2 border-white font-medium"
                  : "text-[#8B8F97] hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Global Rules Tab ─────────────────────────────────────────── */}
        {activeTab === "global-rules" && (
          <div className="space-y-8">
            {/* CRM Update & Rep Notification */}
            <div>
              <h3 className="text-white font-semibold text-base mb-4">CRM Update & Rep Notification</h3>
              <div className="space-y-5">
                {/* Slack */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#E0E0E0] text-sm">Slack: Real-time alert with lead name, company, score, and qualification reason</p>
                    <p className="text-[#555A63] text-[11px] mt-0.5 mb-2">Select up to 3 channels or people to notify</p>
                    <SlackMultiPicker
                      selected={settings.notifications.slackChannels ?? []}
                      onChange={(targets) => {
                        if (!settings) return;
                        setSettings({
                          ...settings,
                          notifications: {
                            ...settings.notifications,
                            slackChannels: targets,
                            slackChannel: targets[0]?.name ?? "",
                          },
                        });
                        markDirty();
                      }}
                      options={slackOptions}
                      loadingOptions={slackLoading}
                      max={3}
                    />
                  </div>
                  <SettingsToggle
                    enabled={settings.notifications.slack}
                    onToggle={() => updateNotification("slack", !settings.notifications.slack)}
                  />
                </div>
                {/* Email */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#E0E0E0] text-sm">Email: Detailed brief with full context, talking points, and next steps</p>
                    <p className="text-[#555A63] text-[11px] mt-0.5 mb-2">Add up to 3 email addresses to notify</p>
                    <EmailMultiInput
                      emails={settings.notifications.emailAddresses ?? (settings.notifications.emailAddress ? [settings.notifications.emailAddress] : [])}
                      onChange={(emails) => {
                        if (!settings) return;
                        setSettings({
                          ...settings,
                          notifications: {
                            ...settings.notifications,
                            emailAddresses: emails,
                            emailAddress: emails[0] ?? "",
                          },
                        });
                        markDirty();
                      }}
                      max={3}
                    />
                  </div>
                  <SettingsToggle
                    enabled={settings.notifications.email}
                    onToggle={() => updateNotification("email", !settings.notifications.email)}
                  />
                </div>
                {/* Task Created */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#E0E0E0] text-sm">Task Created: &quot;Follow up with [Lead Name]&quot; assigned with 24h deadline</p>
                    <input
                      type="text"
                      value={settings.notifications.taskAssignee ?? ""}
                      onChange={(e) => updateNotification("taskAssignee", e.target.value)}
                      placeholder="Sales Manager"
                      className="mt-2 bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 w-[200px]"
                    />
                  </div>
                  <SettingsToggle
                    enabled={settings.notifications.taskCreation}
                    onToggle={() => updateNotification("taskCreation", !settings.notifications.taskCreation)}
                  />
                </div>
              </div>
            </div>

            {/* Escalation Rules */}
            <div>
              <h3 className="text-white font-bold text-base mb-1">Escalation Rules</h3>
              <p className="text-[#8B8F97] text-xs mb-4">
                Conditions where SKYLER must always escalate to you, regardless of autonomy level.
              </p>
              <div className="space-y-4">
                {/* Deal value — with threshold input */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[#E0E0E0] text-sm flex-1">Deal value exceeds escalation threshold</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center bg-[#111111] border border-[#2A2D35] rounded-lg overflow-hidden">
                      <span className="px-2 text-[#8B8F97] text-xs">$</span>
                      <input
                        type="number"
                        value={settings.escalationRules.dealValueThreshold ?? 5000}
                        onChange={(e) => updateEscalation("dealValueThreshold", Math.max(0, Number(e.target.value)))}
                        className="w-[72px] bg-transparent py-1.5 pr-2 text-xs text-white text-right outline-none"
                        min={0}
                      />
                    </div>
                    <SettingsToggle
                      enabled={settings.escalationRules.dealValueExceedsThreshold}
                      onToggle={() => updateEscalation("dealValueExceedsThreshold", !settings.escalationRules.dealValueExceedsThreshold)}
                    />
                  </div>
                </div>
                {/* Other escalation rules */}
                {([
                  ["vipAccount", "Contact is marked as VIP/key account"],
                  ["negativeSentiment", "Negative sentiment detected in prospect reply"],
                  ["firstContact", "First contact with a new lead"],
                  ["cSuiteContact", "Any action involving C-suite contacts"],
                  ["pricingNegotiation", "Pricing negotiation detected"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <p className="text-[#E0E0E0] text-sm">{label}</p>
                    <SettingsToggle
                      enabled={settings.escalationRules[key]}
                      onToggle={() => updateEscalation(key, !settings.escalationRules[key])}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Lead Qualification Tab ───────────────────────────────────── */}
        {activeTab === "lead-qualification" && (
          <div className="space-y-8">
            {/* Score Generation */}
            <div>
              <h3 className="text-white font-semibold text-base mb-4">Score Generation (0-100)</h3>

              {/* Weight distribution bar */}
              <WeightDistributionBar dimensions={settings.scoringDimensions} />

              <div className="space-y-4">
                {settings.scoringDimensions.map((dim, i) => {
                  const isEditing = editingDimension === i;
                  return (
                    <div key={i}>
                      {isEditing && editDimensionValues ? (
                        <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <input
                              value={editDimensionValues.name}
                              onChange={(e) => setEditDimensionValues({ ...editDimensionValues, name: e.target.value })}
                              className="bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-sm text-white outline-none flex-1"
                              placeholder="Dimension name"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={editDimensionValues.weight}
                                onChange={(e) => setEditDimensionValues({ ...editDimensionValues, weight: Number(e.target.value) })}
                                className="w-16 bg-[#111111] border border-[#2A2D35] rounded-lg px-2 py-1.5 text-sm text-white text-center outline-none"
                                min={0}
                                max={100}
                              />
                              <span className="text-[#8B8F97] text-sm">%</span>
                            </div>
                          </div>
                          <input
                            value={editDimensionValues.description}
                            onChange={(e) => setEditDimensionValues({ ...editDimensionValues, description: e.target.value })}
                            className="w-full bg-[#111111] border border-[#2A2D35] rounded-lg px-3 py-1.5 text-xs text-[#8B8F97] outline-none"
                            placeholder="Description"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                updateDimension(i, editDimensionValues);
                                setEditingDimension(null);
                                setEditDimensionValues(null);
                              }}
                              className="flex items-center gap-1 px-3 py-1 bg-[#4ADE80]/20 text-[#4ADE80] rounded-lg text-xs font-medium hover:bg-[#4ADE80]/30"
                            >
                              <Check className="w-3 h-3" />
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingDimension(null); setEditDimensionValues(null); }}
                              className="flex items-center gap-1 px-3 py-1 bg-white/5 text-[#8B8F97] rounded-lg text-xs font-medium hover:bg-white/10"
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </button>
                            <button
                              onClick={() => { removeDimension(i); setEditingDimension(null); setEditDimensionValues(null); }}
                              className="flex items-center gap-1 px-3 py-1 bg-[#F87171]/10 text-[#F87171] rounded-lg text-xs font-medium hover:bg-[#F87171]/20 ml-auto"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: DIMENSION_COLORS[i % DIMENSION_COLORS.length] }}
                          />
                          <span className="text-white text-sm font-medium min-w-0">{dim.name}</span>
                          <input
                            type="number"
                            value={dim.weight}
                            onChange={(e) => updateDimension(i, { ...dim, weight: Math.max(0, Math.min(100, Number(e.target.value))) })}
                            className="w-14 bg-[#111111] border border-[#2A2D35] rounded-md px-2 py-1 text-xs text-white text-center outline-none focus:border-[#F2903D]/50"
                            min={0}
                            max={100}
                          />
                          <span className="text-[#8B8F97] text-xs">%</span>
                          <button
                            onClick={() => { setEditingDimension(i); setEditDimensionValues({ ...dim }); }}
                            className="flex items-center gap-1 text-[#F2903D] text-xs font-medium hover:text-[#F2903D]/80"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => removeDimension(i)}
                            className="text-[#F87171]/60 hover:text-[#F87171] transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {editingDimension !== i && (
                        <p className="text-[#555A63] text-xs mt-0.5 ml-[22px]">{dim.description}</p>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={addDimension}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 text-[#8B8F97] rounded-lg text-xs font-medium hover:bg-white/10 hover:text-white transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Dimension
                </button>
              </div>
            </div>

            {/* Automated Routing Decision — editable cards */}
            <div>
              <h3 className="text-white font-semibold text-base mb-4">Automated Routing Decision</h3>
              <div className="grid grid-cols-3 gap-3">
                {sortedRoutingRules.map((rule, displayIdx) => {
                  // Find actual index in settings.routingRules for updating
                  const actualIdx = settings.routingRules.findIndex((r) => r.label === rule.label);
                  const config = ROUTING_CARD_CONFIG[rule.label] ?? ROUTING_CARD_CONFIG["Low Priority"];
                  const Icon = config.icon;

                  return (
                    <div
                      key={rule.label}
                      className={cn(
                        "rounded-xl border p-4 transition-all",
                        config.bgTint,
                        config.borderTint
                      )}
                    >
                      <Icon className={cn("w-5 h-5 mb-2", config.iconColor)} />
                      <h4 className={cn("font-semibold text-sm mb-2", config.labelColor)}>{rule.label}</h4>
                      <div className="flex items-center gap-1.5 mb-2">
                        <input
                          type="number"
                          value={rule.minScore}
                          onChange={(e) => updateRoutingBoundary(displayIdx, "minScore", Number(e.target.value))}
                          className="w-12 bg-[#111111] border border-[#2A2D35] rounded-md px-1.5 py-1 text-xs text-white text-center outline-none focus:border-[#F2903D]/50"
                          min={0}
                          max={100}
                        />
                        <span className="text-[#555A63] text-xs">&mdash;</span>
                        <input
                          type="number"
                          value={rule.maxScore}
                          onChange={(e) => updateRoutingBoundary(displayIdx, "maxScore", Number(e.target.value))}
                          className="w-12 bg-[#111111] border border-[#2A2D35] rounded-md px-1.5 py-1 text-xs text-white text-center outline-none focus:border-[#F2903D]/50"
                          min={0}
                          max={100}
                          disabled={displayIdx === 0} // Top card always ends at 100
                        />
                      </div>
                      <p className="text-[#555A63] text-[11px] leading-relaxed">{rule.description}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[#555A63] text-[11px] mt-3 italic">
                Ranges auto-adjust to stay contiguous. No gaps, no overlaps.
              </p>
            </div>
          </div>
        )}

        {/* ── Sales Closer Tab ─────────────────────────────────────────── */}
        {activeTab === "sales-closer" && (
          <div className="space-y-10">

            {/* ─ Your Sales Process ─────────────────────────────────────── */}
            <div className="space-y-6">
              <h3 className="text-white font-bold text-base">Your Sales Process</h3>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Primary Goal</label>
                <p className="text-[#555A63] text-xs mb-2">What should SKYLER aim for in every conversation?</p>
                <ChipSelect
                  options={["Book demos", "Schedule calls", "Get replies", "Close deals", "Gather info"]}
                  value={settings.primaryGoal}
                  onChange={(v) => updateSettings({ primaryGoal: v })}
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Sales Journey</label>
                <p className="text-[#555A63] text-xs mb-2">
                  Describe your typical sales process from first contact to close. SKYLER will follow this flow.
                </p>
                <textarea
                  value={settings.salesJourney}
                  onChange={(e) => updateSettings({ salesJourney: e.target.value })}
                  placeholder="e.g. Cold outreach → Discovery call → Demo → Proposal → Negotiation → Close"
                  rows={3}
                  className="w-full bg-[#111111] border border-[#2A2D35] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 resize-none leading-relaxed"
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Pricing Structure</label>
                <p className="text-[#555A63] text-xs mb-2">
                  Give SKYLER context on your pricing so she can handle questions naturally.
                </p>
                <textarea
                  value={settings.pricingStructure}
                  onChange={(e) => updateSettings({ pricingStructure: e.target.value })}
                  placeholder="e.g. Starter $49/mo, Pro $149/mo, Enterprise custom pricing. Annual discount 20%."
                  rows={3}
                  className="w-full bg-[#111111] border border-[#2A2D35] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555A63] outline-none focus:border-[#F2903D]/50 resize-none leading-relaxed"
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Average Sales Cycle</label>
                <ChipSelect
                  options={["Under 1 week", "1-4 weeks", "1-3 months", "3-6 months", "6+ months"]}
                  value={settings.averageSalesCycle}
                  onChange={(v) => updateSettings({ averageSalesCycle: v })}
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Average Deal Size</label>
                <ChipSelect
                  options={["Under $1K", "$1K-$10K", "$10K-$50K", "$50K-$100K", "$100K+"]}
                  value={settings.averageDealSize}
                  onChange={(v) => updateSettings({ averageDealSize: v })}
                />
              </div>
            </div>

            {/* ─ Communication Style ───────────────────────────────────── */}
            <div className="space-y-6">
              <h3 className="text-white font-bold text-base">Communication Style</h3>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Formality</label>
                <ChipSelect
                  options={["Very formal", "Professional but friendly", "Casual", "Match the prospect"]}
                  value={settings.formality}
                  onChange={(v) => updateSettings({ formality: v })}
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Communication Approach</label>
                <ChipSelect
                  options={["Consultative", "Direct/assertive", "Storytelling", "Data-driven", "Relationship-first"]}
                  value={settings.communicationApproach}
                  onChange={(v) => updateSettings({ communicationApproach: v })}
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Phrases to Always Use</label>
                <p className="text-[#555A63] text-xs mb-2">
                  Brand language, value props, or phrases SKYLER should include when relevant.
                </p>
                <TagInput
                  tags={settings.phrasesToAlwaysUse}
                  onChange={(tags) => updateSettings({ phrasesToAlwaysUse: tags })}
                  placeholder='e.g. "We help teams ship faster"'
                  color="green"
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Phrases to Never Use</label>
                <p className="text-[#555A63] text-xs mb-2">
                  Words or phrases SKYLER should avoid in all communications.
                </p>
                <TagInput
                  tags={settings.phrasesToNeverUse}
                  onChange={(tags) => updateSettings({ phrasesToNeverUse: tags })}
                  placeholder='e.g. "just checking in"'
                  color="red"
                />
              </div>
            </div>

            {/* ─ Follow-up Behaviour ──────────────────────────────────── */}
            <div className="space-y-6">
              <h3 className="text-white font-bold text-base">Follow-up Behaviour</h3>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Max Follow-up Attempts</label>
                <p className="text-[#555A63] text-xs mb-2">
                  How many follow-ups before SKYLER sends a breakup email?
                </p>
                <ChipSelect
                  options={["2", "3", "4", "5", "6"]}
                  value={String(settings.maxFollowUpAttempts)}
                  onChange={(v) => updateSettings({ maxFollowUpAttempts: Number(v) })}
                />
              </div>

              <div>
                <label className="text-[#E0E0E0] text-sm block mb-2">Book Demos Using</label>
                <p className="text-[#555A63] text-xs mb-2">
                  How should SKYLER propose meetings to prospects?
                </p>
                <ChipSelect
                  options={["Calendly link", "Suggest 2-3 times", "Ask for availability", "Direct calendar invite"]}
                  value={settings.bookDemosUsing}
                  onChange={(v) => updateSettings({ bookDemosUsing: v })}
                />
              </div>
            </div>

            {/* ─ Autonomy Toggles ─────────────────────────────────────── */}
            <div className="space-y-5">
              <h3 className="text-white font-bold text-base">What SKYLER Can Do Autonomously</h3>
              <p className="text-[#8B8F97] text-xs -mt-3">
                Fine-tune which actions SKYLER can take without your approval.
              </p>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[#E0E0E0] text-sm font-medium">Send follow-up emails</p>
                    <p className="text-[#555A63] text-xs mt-0.5">
                      SKYLER sends scheduled follow-ups in the cadence without asking
                    </p>
                  </div>
                  <SettingsToggle
                    enabled={settings.autonomyToggles.sendFollowUps}
                    onToggle={() => updateAutonomyToggle("sendFollowUps", !settings.autonomyToggles.sendFollowUps)}
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[#E0E0E0] text-sm font-medium">Handle objections</p>
                    <p className="text-[#555A63] text-xs mt-0.5">
                      SKYLER responds to prospect objections using your playbook
                    </p>
                  </div>
                  <SettingsToggle
                    enabled={settings.autonomyToggles.handleObjections}
                    onToggle={() => updateAutonomyToggle("handleObjections", !settings.autonomyToggles.handleObjections)}
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[#E0E0E0] text-sm font-medium">Book meetings</p>
                    <p className="text-[#555A63] text-xs mt-0.5">
                      SKYLER can propose and confirm meeting times directly
                    </p>
                  </div>
                  <SettingsToggle
                    enabled={settings.autonomyToggles.bookMeetings}
                    onToggle={() => updateAutonomyToggle("bookMeetings", !settings.autonomyToggles.bookMeetings)}
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-[#E0E0E0] text-sm font-medium">Require approval for first outreach</p>
                    <p className="text-[#555A63] text-xs mt-0.5">
                      Even in full autonomy mode, SKYLER asks you to approve the very first email to a new lead
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 bg-[#F2903D]/10 border border-[#F2903D]/20 rounded-lg w-fit">
                      <AlertTriangle className="w-3 h-3 text-[#F2903D]" />
                      <span className="text-[#F2903D] text-[11px] font-medium">Recommended — prevents accidental cold outreach</span>
                    </div>
                  </div>
                  <SettingsToggle
                    enabled={settings.autonomyToggles.firstOutreachApproval}
                    onToggle={() => updateAutonomyToggle("firstOutreachApproval", !settings.autonomyToggles.firstOutreachApproval)}
                  />
                </div>

                {/* Knowledge Gap Handling */}
                <div className="pt-4 border-t border-[#2A2D35]">
                  <p className="text-[#E0E0E0] text-sm font-medium mb-1">When SKYLER needs information she doesn&apos;t have</p>
                  <p className="text-[#555A63] text-xs mb-3">
                    Controls how SKYLER handles missing data when drafting emails, proposals, or contracts.
                  </p>
                  <div className="space-y-2">
                    <label
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                        settings.knowledgeGapHandling === "ask_first"
                          ? "border-[#3A89FF] bg-[#3A89FF]/10"
                          : "border-[#2A2D35] bg-transparent hover:border-[#3A3D45]"
                      )}
                      onClick={() => { updateSettings({ knowledgeGapHandling: "ask_first" }); }}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        settings.knowledgeGapHandling === "ask_first" ? "border-[#3A89FF]" : "border-[#555A63]"
                      )}>
                        {settings.knowledgeGapHandling === "ask_first" && (
                          <div className="w-2 h-2 rounded-full bg-[#3A89FF]" />
                        )}
                      </div>
                      <div>
                        <p className="text-[#E0E0E0] text-sm font-medium">Ask me first</p>
                        <p className="text-[#555A63] text-xs">SKYLER pauses and asks you for the missing details before proceeding</p>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                        settings.knowledgeGapHandling === "draft_best_attempt"
                          ? "border-[#3A89FF] bg-[#3A89FF]/10"
                          : "border-[#2A2D35] bg-transparent hover:border-[#3A3D45]"
                      )}
                      onClick={() => { updateSettings({ knowledgeGapHandling: "draft_best_attempt" }); }}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        settings.knowledgeGapHandling === "draft_best_attempt" ? "border-[#3A89FF]" : "border-[#555A63]"
                      )}>
                        {settings.knowledgeGapHandling === "draft_best_attempt" && (
                          <div className="w-2 h-2 rounded-full bg-[#3A89FF]" />
                        )}
                      </div>
                      <div>
                        <p className="text-[#E0E0E0] text-sm font-medium">Draft best attempt and flag for review</p>
                        <p className="text-[#555A63] text-xs">SKYLER proceeds with a draft, marks gaps explicitly, and sends it to your approval queue with a warning</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Meeting Intelligence Tab ──────────────────────────────────── */}
        {activeTab === "meetings" && (
          <div className="space-y-8">
            {/* Auto-join Meetings */}
            <div>
              <h3 className="text-white font-semibold text-base mb-1">Meeting Recording</h3>
              <p className="text-[#8B8F97] text-xs mb-4">
                Skyler can automatically join meetings with your prospects to transcribe, extract intelligence, and craft informed follow-ups.
              </p>

              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-[#8B8F97]" />
                      <span className="text-white text-sm font-medium">Auto-join meetings with prospects</span>
                    </div>
                    <p className="text-[#8B8F97] text-xs mt-1 ml-6">
                      When enabled, Skyler automatically schedules a notetaker bot for any meeting that has an attendee matching an active lead in your pipeline.
                    </p>
                  </div>
                  <SettingsToggle
                    enabled={meetingSettings.autoJoinMeetings}
                    onToggle={() => updateMeetingSetting("autoJoinMeetings", !meetingSettings.autoJoinMeetings)}
                  />
                </div>

                {/* Bot Display Name */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-[#8B8F97]" />
                    <span className="text-white text-sm font-medium">Bot display name</span>
                  </div>
                  <p className="text-[#8B8F97] text-xs mb-2 ml-6">
                    The name shown when the notetaker bot joins a meeting.
                  </p>
                  <input
                    type="text"
                    value={meetingSettings.botDisplayName}
                    onChange={(e) => updateMeetingSetting("botDisplayName", e.target.value)}
                    placeholder="Skyler - Your Company"
                    className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2 text-white text-sm placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#3A89FF]/50 ml-6 max-w-[400px]"
                  />
                </div>
              </div>
            </div>

            {/* Calendar Connection */}
            <div>
              <h3 className="text-white font-semibold text-base mb-1">Calendar Connection</h3>
              <p className="text-[#8B8F97] text-xs mb-4">
                Connect your calendar so Skyler can detect meetings with pipeline leads and automatically schedule recording bots.
              </p>

              {meetingSettings.calendarConnected ? (
                <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#4ADE80]/10 flex items-center justify-center">
                        <Calendar className="w-4 h-4 text-[#4ADE80]" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">
                          {meetingSettings.calendarProvider === "google" ? "Google Calendar" : "Outlook Calendar"} connected
                        </p>
                        <p className="text-[#8B8F97] text-xs">{meetingSettings.calendarEmail}</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 text-[#4ADE80] text-xs font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" />
                      Connected
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-[#3A89FF]/10 flex items-center justify-center">
                      <Link2 className="w-4 h-4 text-[#3A89FF]" />
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">No calendar connected</p>
                      <p className="text-[#8B8F97] text-xs">Connect Google Calendar or Outlook to enable auto-recording</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.open(`/api/skyler/calendar/authorize?workspaceId=${workspaceId}`, "_blank")}
                      className="px-4 py-2 bg-[#1C1F24] border border-[#2A2D35] rounded-lg text-white text-sm hover:bg-[#2A2D35]/50 transition-colors flex items-center gap-2"
                    >
                      <Calendar className="w-4 h-4" />
                      Google Calendar
                    </button>
                    <button
                      onClick={() => window.open(`/api/skyler/calendar/connect?provider=outlook&workspaceId=${workspaceId}`, "_blank")}
                      className="px-4 py-2 bg-[#1C1F24] border border-[#2A2D35] rounded-lg text-white text-sm hover:bg-[#2A2D35]/50 transition-colors flex items-center gap-2"
                    >
                      <Calendar className="w-4 h-4" />
                      Outlook Calendar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="bg-[#3A89FF]/5 border border-[#3A89FF]/20 rounded-xl p-4">
              <p className="text-[#3A89FF] text-xs font-medium mb-1">How Meeting Intelligence Works</p>
              <p className="text-[#8B8F97] text-xs leading-relaxed">
                When a meeting with a pipeline lead is detected, Skyler sends a notetaker bot to join the call.
                After the meeting, the transcript is processed through three AI stages: intelligence extraction
                (action items, objections, buying signals), summary generation, and follow-up strategy. The meeting
                context is then used to craft informed, personalised follow-up emails that reference what was actually
                discussed on the call.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Save Button (sticky bottom) ────────────────────────────────── */}
      <div className="sticky bottom-0 bg-[#1B1B1B] border-t border-[#2A2D35]/40 px-8 py-4 flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1.5 text-[#4ADE80] text-xs font-medium">
            <Check className="w-3.5 h-3.5" />
            Settings saved
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={cn(
            "px-6 py-2.5 rounded-xl text-sm font-semibold transition-all",
            dirty && !saving
              ? "bg-[#F2903D] text-white hover:bg-[#E07E2D] cursor-pointer"
              : "bg-[#F2903D]/30 text-white/40 cursor-not-allowed"
          )}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving...
            </span>
          ) : (
            "Save Settings"
          )}
        </button>
      </div>
    </div>
  );
}

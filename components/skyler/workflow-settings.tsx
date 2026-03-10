"use client";

import { useState, useEffect, useCallback } from "react";
import { Zap, PenLine, Loader2, Pencil, Check, X, Plus, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

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
    email: boolean;
    taskCreation: boolean;
  };
  escalationRules: {
    dealValueExceedsThreshold: boolean;
    vipAccount: boolean;
    negativeSentiment: boolean;
    firstContact: boolean;
    cSuiteContact: boolean;
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
};

type SettingsTab = "global-rules" | "lead-qualification" | "sales-closer";

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

/** Selectable chip row — single selection from a list of options */
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

/** Tag input — add/remove string tags */
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

// ── Main Component ──────────────────────────────────────────────────────────

export function WorkflowSettings({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<WorkflowSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("global-rules");
  const [editingDimension, setEditingDimension] = useState<number | null>(null);
  const [editDimensionValues, setEditDimensionValues] = useState<ScoringDimension | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/skyler/workflow-settings?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Local update — marks dirty, does NOT save
  function updateSettings(partial: Partial<WorkflowSettings>) {
    if (!settings) return;
    setSettings({ ...settings, ...partial });
    setDirty(true);
    setSaved(false);
  }

  function updateNotification(key: keyof WorkflowSettings["notifications"], value: boolean) {
    if (!settings) return;
    setSettings({ ...settings, notifications: { ...settings.notifications, [key]: value } });
    setDirty(true);
    setSaved(false);
  }

  function updateEscalation(key: keyof WorkflowSettings["escalationRules"], value: boolean) {
    if (!settings) return;
    setSettings({ ...settings, escalationRules: { ...settings.escalationRules, [key]: value } });
    setDirty(true);
    setSaved(false);
  }

  function updateAutonomyToggle(key: keyof WorkflowSettings["autonomyToggles"], value: boolean) {
    if (!settings) return;
    setSettings({ ...settings, autonomyToggles: { ...settings.autonomyToggles, [key]: value } });
    setDirty(true);
    setSaved(false);
  }

  function updateDimension(index: number, dim: ScoringDimension) {
    if (!settings) return;
    const dims = [...settings.scoringDimensions];
    dims[index] = dim;
    setSettings({ ...settings, scoringDimensions: dims });
    setDirty(true);
    setSaved(false);
  }

  function addDimension() {
    if (!settings) return;
    const dims = [...settings.scoringDimensions, { name: "New Dimension", weight: 10, description: "Description here." }];
    setSettings({ ...settings, scoringDimensions: dims });
    setDirty(true);
    setSaved(false);
    setEditingDimension(dims.length - 1);
    setEditDimensionValues(dims[dims.length - 1]);
  }

  function removeDimension(index: number) {
    if (!settings) return;
    const dims = settings.scoringDimensions.filter((_, i) => i !== index);
    setSettings({ ...settings, scoringDimensions: dims });
    setDirty(true);
    setSaved(false);
  }

  // Manual save
  async function handleSave() {
    if (!settings || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/skyler/workflow-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, settings }),
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
  ];

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
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[#E0E0E0] text-sm">Slack: Real-time alert with lead name, company, score, and qualification reason</p>
                  <SettingsToggle
                    enabled={settings.notifications.slack}
                    onToggle={() => updateNotification("slack", !settings.notifications.slack)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[#E0E0E0] text-sm">Email: Detailed brief with full context, talking points, and next steps</p>
                  <SettingsToggle
                    enabled={settings.notifications.email}
                    onToggle={() => updateNotification("email", !settings.notifications.email)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[#E0E0E0] text-sm">Task Created: &quot;Follow up with [Lead Name]&quot; assigned with 24h deadline</p>
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
                {([
                  ["dealValueExceedsThreshold", "Deal value exceeds escalation threshold"],
                  ["vipAccount", "Contact is marked as VIP/key account"],
                  ["negativeSentiment", "Negative sentiment detected in prospect reply"],
                  ["firstContact", "First contact with a new lead"],
                  ["cSuiteContact", "Any action involving C-suite contacts"],
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
              <h3 className="text-white font-semibold text-base mb-1">Score Generation (0-100)</h3>
              <div className="mt-4 space-y-5">
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
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="text-white text-sm font-medium">
                              {dim.name}{dim.weight > 0 ? ` (${dim.weight}%):` : ":"}
                            </span>
                            <span className="px-2.5 py-0.5 border border-[#2A2D35] rounded-md text-white text-xs bg-[#1C1F24]">
                              {dim.weight}%
                            </span>
                            <button
                              onClick={() => { setEditingDimension(i); setEditDimensionValues({ ...dim }); }}
                              className="flex items-center gap-1 text-[#F2903D] text-xs font-medium hover:text-[#F2903D]/80"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                          </div>
                          <p className="text-[#555A63] text-xs mt-1">{dim.description}</p>
                        </div>
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

            {/* Automated Routing Decision */}
            <div>
              <h3 className="text-white font-semibold text-base mb-4">Automated Routing Decision</h3>
              <div className="space-y-3">
                {settings.routingRules.map((rule, i) => (
                  <div key={i} className="text-sm">
                    <span className="text-[#E0E0E0]">
                      Score {rule.minScore}-{rule.maxScore}:
                    </span>{" "}
                    <span className="text-[#8B8F97]">{rule.description}</span>
                  </div>
                ))}
              </div>
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
              </div>
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

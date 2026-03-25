"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  Mail,
  MailOpen,
  Reply,
  Calendar,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  Clock,
  UserPlus,
  FileText,
  HelpCircle,
  RefreshCw,
  Search,
  ChevronDown,
} from "lucide-react";

type AgentActivity = {
  id: string;
  agent_type: string;
  activity_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  related_entity_id: string | null;
  related_entity_type: string | null;
  created_at: string;
};

type FilterType = "all" | "emails" | "leads" | "meetings" | "pipeline";

const ACTIVITY_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; label: string; group: FilterType }
> = {
  email_drafted: { icon: Mail, color: "#3A89FF", bg: "rgba(58,137,255,0.1)", label: "Email Drafted", group: "emails" },
  email_sent: { icon: MailOpen, color: "#4ADE80", bg: "rgba(74,222,128,0.1)", label: "Email Sent", group: "emails" },
  reply_detected: { icon: Reply, color: "#34D399", bg: "rgba(52,211,153,0.1)", label: "Reply Detected", group: "emails" },
  meeting_booked: { icon: Calendar, color: "#7C3AED", bg: "rgba(124,58,237,0.1)", label: "Meeting Booked", group: "meetings" },
  meeting_no_show: { icon: AlertTriangle, color: "#FB923C", bg: "rgba(251,146,60,0.1)", label: "No-Show", group: "meetings" },
  escalation_raised: { icon: AlertTriangle, color: "#F87171", bg: "rgba(248,113,113,0.1)", label: "Escalation", group: "pipeline" },
  deal_stage_changed: { icon: TrendingUp, color: "#3A89FF", bg: "rgba(58,137,255,0.1)", label: "Stage Changed", group: "pipeline" },
  deal_closed_won: { icon: TrendingUp, color: "#4ADE80", bg: "rgba(74,222,128,0.1)", label: "Deal Won", group: "pipeline" },
  deal_closed_lost: { icon: TrendingUp, color: "#F87171", bg: "rgba(248,113,113,0.1)", label: "Deal Lost", group: "pipeline" },
  lead_scored: { icon: UserPlus, color: "#FBB040", bg: "rgba(251,176,64,0.1)", label: "Lead Scored", group: "leads" },
  lead_created: { icon: UserPlus, color: "#3A89FF", bg: "rgba(58,137,255,0.1)", label: "Lead Created", group: "leads" },
  followup_scheduled: { icon: Clock, color: "#8B8F97", bg: "rgba(139,143,151,0.1)", label: "Follow-up Scheduled", group: "emails" },
  info_requested: { icon: HelpCircle, color: "#FBB040", bg: "rgba(251,176,64,0.1)", label: "Info Requested", group: "pipeline" },
  research_completed: { icon: Search, color: "#22D3EE", bg: "rgba(34,211,238,0.1)", label: "Research Done", group: "leads" },
  note_created: { icon: FileText, color: "#8B8F97", bg: "rgba(139,143,151,0.1)", label: "Note Created", group: "pipeline" },
  crm_synced: { icon: RefreshCw, color: "#818CF8", bg: "rgba(129,140,248,0.1)", label: "CRM Synced", group: "pipeline" },
  reengagement_started: { icon: MessageSquare, color: "#FB923C", bg: "rgba(251,146,60,0.1)", label: "Re-engagement", group: "emails" },
};

const FILTER_TABS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All Activity" },
  { id: "emails", label: "Emails" },
  { id: "leads", label: "Leads" },
  { id: "meetings", label: "Meetings" },
  { id: "pipeline", label: "Pipeline" },
];

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

function groupByDate(activities: AgentActivity[]): { date: string; items: AgentActivity[] }[] {
  const groups: Record<string, AgentActivity[]> = {};
  for (const a of activities) {
    const key = new Date(a.created_at).toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  return Object.entries(groups).map(([, items]) => ({
    date: items[0].created_at,
    items,
  }));
}

export function SkylerActivityView({ workspaceId }: { workspaceId: string }) {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [limit, setLimit] = useState(50);

  const fetchActivities = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit), agentType: "skyler" });
      const res = await fetch(`/api/agent-activities?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchActivities();
    const interval = setInterval(fetchActivities, 30000);
    return () => clearInterval(interval);
  }, [fetchActivities]);

  const filtered =
    filter === "all"
      ? activities
      : activities.filter((a) => {
          const cfg = ACTIVITY_CONFIG[a.activity_type];
          return cfg?.group === filter;
        });

  const dateGroups = groupByDate(filtered);

  // Count per filter for badges
  const counts: Record<FilterType, number> = { all: activities.length, emails: 0, leads: 0, meetings: 0, pipeline: 0 };
  for (const a of activities) {
    const cfg = ACTIVITY_CONFIG[a.activity_type];
    if (cfg) counts[cfg.group]++;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--sk-bg)" }}>
      {/* Header */}
      <div className="px-8 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center gap-4 mb-1">
          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
            <Image
              src="/skyler-icons/skyler-avatar.png"
              alt="Skyler"
              width={40}
              height={40}
              className="object-cover aspect-square"
            />
          </div>
          <div>
            <h1 className="text-white font-bold text-xl">Skyler Activity</h1>
            <p style={{ color: "var(--sk-t3)", fontSize: 13 }}>
              Everything Skyler has done on your behalf
            </p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-8 flex-shrink-0">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--sk-card)" }}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: filter === tab.id ? "rgba(255,255,255,0.08)" : "transparent",
                color: filter === tab.id ? "#fff" : "var(--sk-t3)",
                borderBottom: filter === tab.id ? "2px solid var(--sk-orange)" : "2px solid transparent",
              }}
            >
              {tab.label}
              {counts[tab.id] > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: filter === tab.id ? "var(--sk-orange)" : "rgba(255,255,255,0.06)",
                    color: filter === tab.id ? "#000" : "var(--sk-t3)",
                  }}
                >
                  {counts[tab.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Activity timeline */}
      <div className="flex-1 overflow-y-auto px-8 pt-6 pb-8">
        {loading ? (
          <div className="flex flex-col gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-[#2A2D35]" />
                <div className="flex-1">
                  <div className="h-4 bg-[#2A2D35] rounded w-3/4 mb-2" />
                  <div className="h-3 bg-[#2A2D35] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "rgba(251,176,64,0.1)" }}
            >
              <Clock className="w-7 h-7" style={{ color: "var(--sk-orange)" }} />
            </div>
            <p className="text-white font-medium mb-1">No activity yet</p>
            <p className="text-sm" style={{ color: "var(--sk-t3)" }}>
              Skyler&apos;s actions will appear here as she works on your leads
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {dateGroups.map((group, gi) => (
              <div key={gi}>
                {/* Date separator */}
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--sk-t3)" }}
                  >
                    {formatDate(group.date)}
                  </span>
                  <div className="flex-1 h-px" style={{ background: "var(--sk-border)" }} />
                </div>

                {/* Activity cards */}
                <div className="space-y-2">
                  {group.items.map((activity) => {
                    const cfg = ACTIVITY_CONFIG[activity.activity_type] ?? {
                      icon: MessageSquare,
                      color: "#8B8F97",
                      bg: "rgba(139,143,151,0.1)",
                      label: activity.activity_type,
                      group: "pipeline" as FilterType,
                    };
                    const Icon = cfg.icon;
                    const contactName = (activity.metadata?.contactName as string) || null;
                    const companyName = (activity.metadata?.companyName as string) || null;

                    return (
                      <div
                        key={activity.id}
                        className="flex gap-4 p-4 rounded-xl transition-colors hover:brightness-110"
                        style={{ background: "var(--sk-card)", border: "1px solid var(--sk-border)" }}
                      >
                        {/* Icon */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: cfg.bg }}
                        >
                          <Icon className="w-5 h-5" style={{ color: cfg.color }} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-white text-sm font-medium leading-snug">
                                {activity.title}
                              </p>
                              {activity.description && (
                                <p
                                  className="text-xs mt-1 line-clamp-2 leading-relaxed"
                                  style={{ color: "var(--sk-t3)" }}
                                >
                                  {activity.description}
                                </p>
                              )}
                            </div>
                            <span
                              className="text-[11px] flex-shrink-0 mt-0.5"
                              style={{ color: "var(--sk-t4)" }}
                            >
                              {formatTimeAgo(activity.created_at)}
                            </span>
                          </div>

                          {/* Metadata chips */}
                          {(contactName || companyName) && (
                            <div className="flex gap-2 mt-2">
                              {contactName && (
                                <span
                                  className="text-[11px] px-2 py-0.5 rounded-md"
                                  style={{ background: "rgba(255,255,255,0.04)", color: "var(--sk-t3)" }}
                                >
                                  {contactName}
                                </span>
                              )}
                              {companyName && (
                                <span
                                  className="text-[11px] px-2 py-0.5 rounded-md"
                                  style={{ background: "rgba(255,255,255,0.04)", color: "var(--sk-t3)" }}
                                >
                                  {companyName}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Load more */}
            {activities.length >= limit && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => setLimit((l) => l + 50)}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    background: "var(--sk-card)",
                    border: "1px solid var(--sk-border)",
                    color: "var(--sk-t2)",
                  }}
                >
                  <ChevronDown className="w-4 h-4" />
                  Load more activity
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

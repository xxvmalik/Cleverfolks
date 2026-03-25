"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  MailOpen,
  Reply,
  Calendar,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  Clock,
  Search,
  UserPlus,
  FileText,
  HelpCircle,
  RefreshCw,
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

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  email_drafted: Mail,
  email_sent: MailOpen,
  reply_detected: Reply,
  meeting_booked: Calendar,
  meeting_no_show: AlertTriangle,
  escalation_raised: AlertTriangle,
  deal_stage_changed: TrendingUp,
  deal_closed_won: TrendingUp,
  deal_closed_lost: TrendingUp,
  lead_scored: UserPlus,
  lead_created: UserPlus,
  followup_scheduled: Clock,
  info_requested: HelpCircle,
  research_completed: Search,
  note_created: FileText,
  crm_synced: RefreshCw,
  reengagement_started: MessageSquare,
};

const ACTIVITY_COLOURS: Record<string, string> = {
  email_drafted: "text-blue-400",
  email_sent: "text-green-400",
  reply_detected: "text-emerald-400",
  meeting_booked: "text-purple-400",
  meeting_no_show: "text-orange-400",
  escalation_raised: "text-red-400",
  deal_stage_changed: "text-blue-300",
  deal_closed_won: "text-green-500",
  deal_closed_lost: "text-red-400",
  lead_scored: "text-yellow-400",
  lead_created: "text-blue-400",
  followup_scheduled: "text-gray-400",
  info_requested: "text-yellow-400",
  research_completed: "text-cyan-400",
  note_created: "text-gray-400",
  crm_synced: "text-indigo-400",
  reengagement_started: "text-orange-300",
};

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

export function ActivityFeed({
  workspaceId,
  limit = 30,
  agentType,
  compact = false,
}: {
  workspaceId: string;
  limit?: number;
  agentType?: string;
  compact?: boolean;
}) {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (agentType) params.set("agentType", agentType);

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
  }, [limit, agentType]);

  useEffect(() => {
    fetchActivities();
    const interval = setInterval(fetchActivities, 30000);
    return () => clearInterval(interval);
  }, [fetchActivities]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-[#2A2D35]" />
            <div className="flex-1">
              <div className="h-4 bg-[#2A2D35] rounded w-3/4 mb-2" />
              <div className="h-3 bg-[#2A2D35] rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[#8B8F97]">
        <Clock className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">No activity yet</p>
        <p className="text-xs mt-1">Agent actions will appear here</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-1" : "gap-0.5"}`}>
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.activity_type] ?? MessageSquare;
        const colour = ACTIVITY_COLOURS[activity.activity_type] ?? "text-gray-400";

        return (
          <div
            key={activity.id}
            className={`flex gap-3 ${compact ? "px-3 py-2" : "px-4 py-3"} hover:bg-[#1C1F24]/50 transition-colors`}
          >
            <div className={`mt-0.5 flex-shrink-0 ${colour}`}>
              <Icon className={compact ? "w-4 h-4" : "w-5 h-5"} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-white ${compact ? "text-xs" : "text-sm"} leading-snug`}>
                {activity.title}
              </p>
              {!compact && activity.description && (
                <p className="text-[#8B8F97] text-xs mt-0.5 line-clamp-2">
                  {activity.description}
                </p>
              )}
              <p className="text-[#8B8F97]/60 text-xs mt-1">
                {formatTimeAgo(activity.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * GET /api/skyler/lead-alerts?pipelineId={id}
 *
 * Returns alerts for a specific lead: notifications + meeting health signals.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type AlertItem = {
  id: string;
  type: string;
  emoji: string;
  text: string;
  timestamp: string;
  source: "notification" | "health_signal";
};

const EMOJI_MAP: Record<string, string> = {
  lead_replied: "💬",
  draft_awaiting_approval: "📝",
  lead_scored_hot: "🔥",
  escalation_triggered: "🚨",
  deal_closed_won: "🎉",
  deal_closed_lost: "😞",
  objection_received: "⚠️",
  meeting_booked: "📅",
  meeting_cancelled: "❌",
  meeting_no_show: "👻",
  meeting_rescheduled: "🔄",
  new_attendee_detected: "👤",
  pre_call_brief: "📋",
  health_signal: "📊",
  no_show: "👻",
  reschedule: "🔄",
  decline: "❌",
  new_attendee: "👤",
  fatigue: "😴",
  duration_drop: "⏱️",
};

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const alerts: AlertItem[] = [];

  // Fetch unread notifications for this lead
  const { data: notifications } = await db
    .from("skyler_notifications")
    .select("id, event_type, title, body, created_at, read")
    .eq("pipeline_id", pipelineId)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(10);

  for (const n of notifications ?? []) {
    alerts.push({
      id: n.id,
      type: n.event_type,
      emoji: EMOJI_MAP[n.event_type] ?? "🔔",
      text: n.body || n.title,
      timestamp: n.created_at,
      source: "notification",
    });
  }

  // Fetch unacknowledged health signals for this lead
  const { data: signals } = await db
    .from("meeting_health_signals")
    .select("id, signal_type, severity, details, created_at, acknowledged")
    .eq("lead_id", pipelineId)
    .eq("acknowledged", false)
    .order("created_at", { ascending: false })
    .limit(10);

  for (const s of signals ?? []) {
    const details = s.details as Record<string, unknown> | null;
    alerts.push({
      id: s.id,
      type: s.signal_type,
      emoji: EMOJI_MAP[s.signal_type] ?? "📊",
      text: (details?.message as string) ?? `${s.signal_type} signal (${s.severity})`,
      timestamp: s.created_at,
      source: "health_signal",
    });
  }

  // Sort by timestamp descending
  alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({ alerts });
}

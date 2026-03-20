// ── Shared types for Skyler Sales Closer UI ──────────────────────────────────

export type ConvoThreadEntry = {
  role: string;
  content: string;
  subject?: string;
  timestamp: string;
  status?: string;
};

export type PendingAction = {
  id: string;
  description: string;
  tool_input?: {
    pipelineId?: string;
    to?: string;
    subject?: string;
    body?: string;
    htmlBody?: string;
    textBody?: string;
    [key: string]: unknown;
  };
  result?: {
    last_error?: string;
    failed_at?: string;
    [key: string]: unknown;
  } | null;
  status: string;
  created_at: string;
};

export type PendingRequest = {
  id: string;
  pipeline_id: string;
  request_description: string;
  created_at: string;
};

export type PipelineRecord = {
  id: string;
  workspace_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  stage: string;
  resolution: string | null;
  emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  cadence_step: number;
  deal_value: number | null;
  tags: string[] | null;
  health_score: number | null;
  lead_score: number | null;
  conversation_thread: ConvoThreadEntry[];
  skyler_note?: { type: string; message: string; created_at: string; resolved: boolean } | null;
  pending_actions: PendingAction[];
  directive_count: number;
  pending_requests: PendingRequest[];
  meeting_count: number;
  updated_at: string;
  created_at: string;
  // Stage 15.1: No-show & re-engagement
  no_show_count?: number;
  re_engagement_status?: "none" | "active" | "completed" | "cancelled";
  re_engagement_touch?: number;
  last_re_engagement_action?: { type: string; timestamp: string; summary: string; action_id?: string } | null;
  next_re_engagement_at?: string | null;
};

export type PerformanceMetrics = {
  totalLeads: number;
  emailsSent: number;
  replyRate: number;
  meetingsBooked: number;
  dealsWon: number;
  conversionRate: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  taggedLead?: { id: string; name: string } | null;
  /** Activity steps that were performed before this message was generated */
  activities?: string[];
};

export type ConversationItem = {
  id: string;
  title: string;
  updated_at: string;
  is_starred?: boolean;
  custom_title?: string;
  lead_name?: string;
  preview?: string;
};

export type TaggedLead = {
  id: string;
  name: string;
  company: string;
  email?: string;
  stage?: string;
  healthScore?: number | null;
};

export type PipelineEvent = {
  id: string;
  event_type: string;
  from_stage?: string;
  to_stage?: string;
  source: string;
  source_detail?: string;
  payload?: Record<string, unknown>;
  created_at: string;
};

export type AlertItem = {
  id: string;
  type: string;
  emoji: string;
  text: string;
  timestamp: string;
  source: "notification" | "health_signal";
};

export type DirectiveItem = {
  id: string;
  directive_text: string;
  created_at: string;
  is_active: boolean;
};

export type MeetingRecord = {
  id: string;
  title: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  meeting_url?: string | null;
  duration_seconds?: number | null;
  no_show_detected: boolean;
  has_transcript: boolean;
  // Transcript enrichment (null if no transcript exists)
  transcript_id?: string | null;
  summary?: string | null;
  intelligence?: Record<string, unknown> | null;
  participants?: unknown[] | null;
  processing_status?: string | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meeting_url: string | null;
  event_type: string | null;
  attendees: Array<{ email: string; name?: string }>;
  pre_call_brief_sent: boolean;
  status: string;
};

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
    [key: string]: unknown;
  };
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
  bot_id?: string;
  meeting_date: string;
  meeting_url?: string;
  summary?: string;
  intelligence?: Record<string, unknown>;
  participants?: unknown[];
  processing_status?: string;
  duration_seconds?: number;
  created_at: string;
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

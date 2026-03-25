/**
 * Agent Activity Logger — fire-and-forget activity tracking.
 * Writes to `agent_activities` table for cross-agent visibility.
 * Never throws — logs errors and continues.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentActivityType =
  | "email_drafted"
  | "email_sent"
  | "lead_scored"
  | "lead_created"
  | "meeting_booked"
  | "deal_stage_changed"
  | "deal_closed_won"
  | "deal_closed_lost"
  | "escalation_raised"
  | "reply_detected"
  | "followup_scheduled"
  | "info_requested"
  | "crm_synced"
  | "research_completed"
  | "note_created"
  | "meeting_no_show"
  | "reengagement_started";

export type AgentActivityParams = {
  workspaceId: string;
  agentType?: string;
  activityType: AgentActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  relatedEntityId?: string;
  relatedEntityType?: string;
};

/**
 * Log an agent activity. Fire-and-forget — never throws.
 */
export async function logAgentActivity(
  db: SupabaseClient,
  params: AgentActivityParams
): Promise<void> {
  try {
    await db.from("agent_activities").insert({
      workspace_id: params.workspaceId,
      agent_type: params.agentType ?? "skyler",
      activity_type: params.activityType,
      title: params.title,
      description: params.description ?? null,
      metadata: params.metadata ?? {},
      related_entity_id: params.relatedEntityId ?? null,
      related_entity_type: params.relatedEntityType ?? null,
    });
  } catch (err) {
    console.error(
      "[agent-activity] Failed to log activity:",
      err instanceof Error ? err.message : err
    );
  }
}

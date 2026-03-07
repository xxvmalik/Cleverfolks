/**
 * Skyler's tool handler — wraps read tools (delegated to CleverBrain handlers)
 * and write tools with 3-level autonomy enforcement.
 */

import { Nango } from "@nangohq/node";
import {
  executeToolCall as executeReadToolCall,
  type ToolHandlerResult,
} from "@/lib/cleverbrain/tool-handlers";
import { SKYLER_WRITE_TOOL_NAMES } from "@/lib/skyler/tools";
import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

type AutonomyLevel = "full" | "approval_required" | "read_only";

// ── Nango action name mapping ────────────────────────────────────────────────

const NANGO_ACTION_MAP: Record<string, string> = {
  create_contact: "create-contact",
  update_contact: "update-contact",
  create_company: "create-company",
  update_company: "update-company",
  create_deal: "create-deal",
  update_deal: "update-deal",
  create_task: "create-task",
  create_note: "create-note",
};

// ── Input → Nango payload mapping ────────────────────────────────────────────

function buildNangoPayload(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  switch (toolName) {
    case "create_contact":
      return {
        firstname: input.first_name,
        lastname: input.last_name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        jobtitle: input.job_title,
        hs_lead_status: "NEW",
      };
    case "update_contact":
      return {
        id: input.contact_id,
        firstname: input.first_name,
        lastname: input.last_name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        jobtitle: input.job_title,
      };
    case "create_company":
      return {
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        description: input.description,
        phone: input.phone,
        city: input.city,
        country: input.country,
      };
    case "update_company":
      return {
        id: input.company_id,
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        description: input.description,
        phone: input.phone,
      };
    case "create_deal":
      return {
        dealname: input.deal_name,
        amount: input.amount ? String(input.amount) : undefined,
        dealstage: input.stage,
        closedate: input.close_date,
        pipeline: input.pipeline ?? "default",
        description: input.notes,
        // Associations handled separately by Nango action
        ...(input.contact_id ? { associations: [{ to: { id: input.contact_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }] } : {}),
      };
    case "update_deal":
      return {
        id: input.deal_id,
        dealname: input.deal_name,
        amount: input.amount ? String(input.amount) : undefined,
        dealstage: input.stage,
        closedate: input.close_date,
        description: input.notes,
      };
    case "create_task":
      return {
        hs_task_subject: input.subject,
        hs_task_body: input.body,
        hs_task_priority: input.priority ?? "MEDIUM",
        hs_timestamp: input.due_date
          ? new Date(input.due_date as string).toISOString()
          : new Date().toISOString(),
        // Associations
        ...(input.contact_id || input.deal_id
          ? {
              associations: [
                ...(input.contact_id
                  ? [{ to: { id: input.contact_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] }]
                  : []),
                ...(input.deal_id
                  ? [{ to: { id: input.deal_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }] }]
                  : []),
              ],
            }
          : {}),
      };
    case "create_note":
      return {
        hs_note_body: input.body,
        hs_timestamp: new Date().toISOString(),
        ...(input.contact_id || input.deal_id || input.company_id
          ? {
              associations: [
                ...(input.contact_id
                  ? [{ to: { id: input.contact_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }]
                  : []),
                ...(input.deal_id
                  ? [{ to: { id: input.deal_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] }]
                  : []),
                ...(input.company_id
                  ? [{ to: { id: input.company_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 190 }] }]
                  : []),
              ],
            }
          : {}),
      };
    default:
      return input;
  }
}

// ── Human-readable action summary ────────────────────────────────────────────

function describeAction(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "create_contact":
      return `Create contact: ${input.first_name} ${input.last_name}${input.email ? ` (${input.email})` : ""}${input.company ? ` at ${input.company}` : ""}`;
    case "update_contact":
      return `Update contact ${input.contact_id}: ${Object.entries(input).filter(([k]) => k !== "contact_id").map(([k, v]) => `${k}=${v}`).join(", ")}`;
    case "create_company":
      return `Create company: ${input.name}${input.domain ? ` (${input.domain})` : ""}`;
    case "update_company":
      return `Update company ${input.company_id}: ${Object.entries(input).filter(([k]) => k !== "company_id").map(([k, v]) => `${k}=${v}`).join(", ")}`;
    case "create_deal":
      return `Create deal: ${input.deal_name}${input.amount ? ` — ${input.amount}` : ""}${input.stage ? ` in ${input.stage}` : ""}`;
    case "update_deal":
      return `Update deal ${input.deal_id}: ${Object.entries(input).filter(([k]) => k !== "deal_id").map(([k, v]) => `${k}=${v}`).join(", ")}`;
    case "create_task":
      return `Create task: ${input.subject}${input.due_date ? ` (due ${input.due_date})` : ""}`;
    case "create_note":
      return `Create note: ${(input.body as string)?.slice(0, 80)}...`;
    default:
      return `${toolName}: ${JSON.stringify(input).slice(0, 120)}`;
  }
}

// ── Execute a write tool via Nango ───────────────────────────────────────────

async function executeViaNango(
  toolName: string,
  input: Record<string, unknown>,
  connectionId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const nangoAction = NANGO_ACTION_MAP[toolName];
  if (!nangoAction) {
    return { success: false, error: `Unknown Nango action for tool: ${toolName}` };
  }

  try {
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    const payload = buildNangoPayload(toolName, input);

    // Strip undefined values
    const cleanPayload = JSON.parse(JSON.stringify(payload));

    console.log(`[skyler-tools] Executing ${nangoAction} via Nango:`, JSON.stringify(cleanPayload).slice(0, 300));

    const result = await nango.triggerAction(
      "hubspot",
      connectionId,
      nangoAction,
      cleanPayload
    );

    console.log(`[skyler-tools] ${nangoAction} succeeded:`, JSON.stringify(result).slice(0, 200));
    return { success: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skyler-tools] ${nangoAction} failed:`, msg);
    return { success: false, error: msg };
  }
}

// ── Get HubSpot connection ID for workspace ──────────────────────────────────

async function getHubSpotConnectionId(
  db: AdminDb,
  workspaceId: string
): Promise<string | null> {
  const { data } = await db
    .from("integrations")
    .select("nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "hubspot")
    .eq("status", "connected")
    .single();
  return data?.nango_connection_id ?? null;
}

// ── Main dispatcher with autonomy enforcement ────────────────────────────────

export async function executeSkylerToolCall(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb,
  autonomyLevel: AutonomyLevel,
  conversationId?: string,
  userId?: string
): Promise<ToolHandlerResult> {
  // ── Read tools: delegate to CleverBrain handlers (no autonomy check) ──
  if (!SKYLER_WRITE_TOOL_NAMES.has(toolName)) {
    return executeReadToolCall(toolName, input, workspaceId, adminSupabase);
  }

  // ── Write tools: enforce autonomy ─────────────────────────────────────
  const description = describeAction(toolName, input);

  // Check HubSpot connection
  const connectionId = await getHubSpotConnectionId(adminSupabase, workspaceId);
  if (!connectionId) {
    return {
      results: [],
      summary: `Cannot execute "${toolName}" — HubSpot is not connected. Ask the user to connect HubSpot from the Connectors page.`,
    };
  }

  // ── READ ONLY: recommend only ─────────────────────────────────────────
  if (autonomyLevel === "read_only") {
    return {
      results: [],
      summary: `[READ_ONLY MODE] I recommend this action but cannot execute it:\n${description}\n\nThe workspace is in read-only mode. Ask the admin to enable write permissions in Skyler Settings.`,
    };
  }

  // ── APPROVAL REQUIRED: save pending action ────────────────────────────
  if (autonomyLevel === "approval_required") {
    const { data: actionId, error } = await adminSupabase
      .from("skyler_actions")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversationId ?? null,
        user_id: userId ?? null,
        tool_name: toolName,
        tool_input: input,
        nango_connection_id: connectionId,
        description,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[skyler-tools] Failed to save pending action:", error);
      return {
        results: [],
        summary: `Failed to save action for approval: ${error.message}`,
      };
    }

    console.log(`[skyler-tools] Pending action created: ${actionId?.id}`);

    return {
      results: [],
      summary: `[ACTION_PENDING:${actionId?.id}] ${description}\n\nThis action requires your approval. Please review and approve or reject it in the chat.`,
    };
  }

  // ── FULL AUTONOMY: execute immediately ────────────────────────────────
  const { success, result, error: execError } = await executeViaNango(
    toolName,
    input,
    connectionId
  );

  if (!success) {
    // Save as failed action for audit trail
    await adminSupabase.from("skyler_actions").insert({
      workspace_id: workspaceId,
      conversation_id: conversationId ?? null,
      user_id: userId ?? null,
      tool_name: toolName,
      tool_input: input,
      nango_connection_id: connectionId,
      description,
      status: "failed",
      result: { error: execError },
    });

    return {
      results: [],
      summary: `Action failed: ${description}\nError: ${execError}`,
    };
  }

  // Save as executed for audit trail
  await adminSupabase.from("skyler_actions").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId ?? null,
    user_id: userId ?? null,
    tool_name: toolName,
    tool_input: input,
    nango_connection_id: connectionId,
    description,
    status: "executed",
    result: result as Record<string, unknown>,
  });

  return {
    results: [],
    summary: `[ACTION_EXECUTED] ${description}\n\nAction completed successfully.`,
  };
}

// ── Execute a previously approved action ─────────────────────────────────────

export async function executeApprovedAction(
  actionId: string,
  adminSupabase: AdminDb
): Promise<{ success: boolean; error?: string }> {
  const { data: action, error: fetchErr } = await adminSupabase
    .from("skyler_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !action) {
    return { success: false, error: "Action not found or already processed" };
  }

  const { success, result, error: execError } = await executeViaNango(
    action.tool_name,
    action.tool_input,
    action.nango_connection_id
  );

  if (!success) {
    await adminSupabase
      .from("skyler_actions")
      .update({ status: "failed", result: { error: execError }, updated_at: new Date().toISOString() })
      .eq("id", actionId);
    return { success: false, error: execError };
  }

  await adminSupabase
    .from("skyler_actions")
    .update({ status: "executed", result: result as Record<string, unknown>, updated_at: new Date().toISOString() })
    .eq("id", actionId);

  return { success: true };
}

// ── Reject a pending action ──────────────────────────────────────────────────

export async function rejectAction(
  actionId: string,
  adminSupabase: AdminDb
): Promise<{ success: boolean; error?: string }> {
  const { error } = await adminSupabase
    .from("skyler_actions")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("status", "pending");

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

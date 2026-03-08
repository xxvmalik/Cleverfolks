/**
 * Skyler's tool handler — wraps read tools (delegated to CleverBrain handlers)
 * and write tools with 3-level autonomy enforcement.
 */

import { Nango } from "@nangohq/node";
import {
  executeToolCall as executeReadToolCall,
  type ToolHandlerResult,
} from "@/lib/cleverbrain/tool-handlers";
import { SKYLER_WRITE_TOOL_NAMES, SKYLER_ACTION_TOOL_NAMES } from "@/lib/skyler/tools";
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
// IMPORTANT: Nango HubSpot uses its OWN model field names, NOT raw HubSpot API property names.
// Deal:    name, amount, deal_stage (stage ID), close_date, deal_description, owner, pipeline
// Contact: first_name, last_name, email, mobile_phone_number, job_title, lifecycle_stage, lead_status
// Company: name, industry, description, country, city, website_url, domain, phone

function buildNangoPayload(
  toolName: string,
  input: Record<string, unknown>,
  context?: { stageId?: string; ownerId?: string }
): Record<string, unknown> {
  switch (toolName) {
    case "create_contact":
      return {
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        mobile_phone_number: input.phone,
        company: input.company,
        job_title: input.job_title,
        lead_status: "NEW",
        owner: context?.ownerId,
      };
    case "update_contact":
      return {
        id: input.contact_id,
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        mobile_phone_number: input.phone,
        company: input.company,
        job_title: input.job_title,
      };
    case "create_company":
      return {
        name: input.name,
        website_url: input.domain,
        // industry must be a HubSpot enum (e.g. INFORMATION_TECHNOLOGY_AND_SERVICES) — omit freeform text
        industry: typeof input.industry === "string" && input.industry.includes("_") ? input.industry : undefined,
        description: input.description,
        city: input.city,
        country: input.country,
        owner: context?.ownerId,
      };
    case "update_company":
      return {
        id: input.company_id,
        name: input.name,
        website_url: input.domain,
        industry: typeof input.industry === "string" && input.industry.includes("_") ? input.industry : undefined,
        description: input.description,
        city: input.city,
        country: input.country,
      };
    case "create_deal": {
      // Format close_date as midnight UTC (HubSpot expects this format)
      let closeDate: string | undefined;
      if (input.close_date) {
        try {
          const d = new Date(input.close_date as string);
          closeDate = d.toISOString().split("T")[0]; // YYYY-MM-DD
        } catch {
          closeDate = input.close_date as string;
        }
      }
      return {
        name: input.deal_name,
        amount: input.amount ? String(input.amount) : undefined,
        deal_stage: context?.stageId ?? input.stage, // Resolved stage ID, falls back to raw input
        close_date: closeDate,
        deal_description: input.notes,
        owner: context?.ownerId, // Auto-assigned HubSpot owner ID
      };
    }
    case "update_deal": {
      let closeDate: string | undefined;
      if (input.close_date) {
        try {
          const d = new Date(input.close_date as string);
          closeDate = d.toISOString().split("T")[0];
        } catch {
          closeDate = input.close_date as string;
        }
      }
      return {
        id: input.deal_id,
        name: input.deal_name,
        amount: input.amount ? String(input.amount) : undefined,
        deal_stage: context?.stageId ?? input.stage,
        close_date: closeDate,
        deal_description: input.notes,
        owner: context?.ownerId,
      };
    }
    case "create_task": {
      // Nango Task model: title, notes, priority, due_date, task_type
      // Associations: contact_id, deal_id, company_id (top-level fields)
      // Owner: owner (HubSpot owner ID)
      let dueDate: string;
      if (input.due_date) {
        try {
          dueDate = new Date(input.due_date as string).toISOString();
        } catch {
          dueDate = new Date().toISOString();
        }
      } else {
        dueDate = new Date().toISOString();
      }
      return {
        title: input.subject,
        notes: input.body,
        priority: (input.priority as string)?.toUpperCase() ?? "MEDIUM",
        due_date: dueDate,
        task_type: "TODO",
        ...(input.contact_id ? { contact_id: input.contact_id } : {}),
        ...(input.deal_id ? { deal_id: input.deal_id } : {}),
        ...(context?.ownerId ? { owner: context.ownerId } : {}),
      };
    }
    case "create_note":
      // Nango's create-note action doesn't map hs_timestamp, so HubSpot always rejects.
      // Pass through raw HubSpot property names as a best-effort attempt.
      return {
        hs_note_body: input.body,
        hs_timestamp: new Date().toISOString(),
      };
    default:
      return input;
  }
}

// ── Human-readable action summary ────────────────────────────────────────────

/** Convert SCREAMING_SNAKE_CASE to Title Case */
function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  job_title: "Job Title",
  domain: "Website",
  industry: "Industry",
  description: "Description",
  city: "City",
  country: "Country",
  deal_name: "Deal Name",
  amount: "Amount",
  stage: "Stage",
  close_date: "Close Date",
  notes: "Notes",
  subject: "Subject",
  body: "Details",
  due_date: "Due Date",
  priority: "Priority",
  name: "Name",
};

/** IDs and internal fields to exclude from descriptions */
const HIDDEN_FIELDS = new Set([
  "contact_id", "company_id", "deal_id", "pipeline",
]);

function formatFieldsHuman(input: Record<string, unknown>, excludeKeys: string[] = []): string {
  const exclude = new Set([...excludeKeys, ...HIDDEN_FIELDS]);
  return Object.entries(input)
    .filter(([k, v]) => !exclude.has(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const label = FIELD_LABELS[k] ?? humanizeEnum(k);
      let val = String(v);
      // Humanize enum values (SCREAMING_SNAKE)
      if (typeof v === "string" && v.includes("_") && v === v.toUpperCase()) {
        val = humanizeEnum(v);
      }
      return `${label}: ${val}`;
    })
    .join(", ");
}

function describeAction(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "create_contact": {
      const name = [input.first_name, input.last_name].filter(Boolean).join(" ");
      const extras: string[] = [];
      if (input.email) extras.push(String(input.email));
      if (input.company) extras.push(`at ${input.company}`);
      return `Create contact: ${name}${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
    case "update_contact": {
      const name = [input.first_name, input.last_name].filter(Boolean).join(" ");
      const label = name || `Contact #${input.contact_id}`;
      const fields = formatFieldsHuman(input, ["first_name", "last_name"]);
      return `Update ${label}${fields ? ` — ${fields}` : ""}`;
    }
    case "create_company": {
      const extras: string[] = [];
      if (input.domain) extras.push(String(input.domain));
      if (input.city) extras.push(String(input.city));
      return `Create company: ${input.name}${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
    case "update_company": {
      const label = input.name ? String(input.name) : `Company #${input.company_id}`;
      const fields = formatFieldsHuman(input, ["name"]);
      return `Update ${label}${fields ? ` — ${fields}` : ""}`;
    }
    case "create_deal": {
      const extras: string[] = [];
      if (input.amount) extras.push(`$${input.amount}`);
      if (input.stage) extras.push(String(input.stage));
      return `Create deal: ${input.deal_name}${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
    case "update_deal": {
      const label = input.deal_name ? String(input.deal_name) : `Deal #${input.deal_id}`;
      const fields = formatFieldsHuman(input, ["deal_name"]);
      return `Update ${label}${fields ? ` — ${fields}` : ""}`;
    }
    case "create_task": {
      const extras: string[] = [];
      if (input.due_date) extras.push(`due ${input.due_date}`);
      if (input.priority) extras.push(String(input.priority));
      return `Create task: ${input.subject}${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
    case "create_note":
      return `Create note: ${(input.body as string)?.slice(0, 100)}`;
    default:
      return `${humanizeEnum(toolName.replace(/_/g, " "))}: ${formatFieldsHuman(input)}`;
  }
}

// ── Resolve stage label → stage ID via fetch-pipelines ───────────────────────

async function resolveStageId(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  stageLabel: string
): Promise<string | undefined> {
  if (!stageLabel) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await nango.triggerAction("hubspot", connectionId, "fetch-pipelines", {});
    const pipelines = result?.pipelines ?? [];
    const lowerLabel = stageLabel.toLowerCase().trim();

    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages ?? []) {
        if (stage.label && stage.label.toLowerCase().trim() === lowerLabel) {
          console.log(`[skyler-tools] Resolved stage "${stageLabel}" → ID "${stage.id}" (pipeline: ${pipeline.label})`);
          return stage.id;
        }
      }
    }
    // If no exact match, try partial/fuzzy match
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages ?? []) {
        if (stage.label && stage.label.toLowerCase().includes(lowerLabel)) {
          console.log(`[skyler-tools] Fuzzy-resolved stage "${stageLabel}" → ID "${stage.id}" (${stage.label})`);
          return stage.id;
        }
      }
    }
    console.warn(`[skyler-tools] Could not resolve stage label "${stageLabel}" — passing raw value`);
    return undefined;
  } catch (err) {
    console.warn(`[skyler-tools] fetch-pipelines failed:`, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

// ── Get default HubSpot owner ID from synced data ────────────────────────────

async function getDefaultOwnerId(
  nango: InstanceType<typeof Nango>,
  connectionId: string
): Promise<string | undefined> {
  try {
    const page = await nango.listRecords({
      providerConfigKey: "hubspot",
      connectionId,
      model: "HubspotOwner",
    });
    // Return the first owner (typically the account admin / primary user)
    const firstOwner = page.records[0];
    if (firstOwner) {
      const id = (firstOwner as Record<string, unknown>).id as string;
      const first = ((firstOwner as Record<string, unknown>).firstName as string) ?? "";
      const last = ((firstOwner as Record<string, unknown>).lastName as string) ?? "";
      console.log(`[skyler-tools] Default owner: ${first} ${last} (${id})`);
      return id;
    }
    return undefined;
  } catch (err) {
    console.warn(`[skyler-tools] Failed to fetch HubSpot owners:`, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

// ── HubSpot association type IDs ──────────────────────────────────────────────
// Verified via /crm/v4/associations/{from}/{to}/labels

const ASSOCIATION_TYPES = {
  task_to_contact: 204,
  task_to_company: 192,
  task_to_deal: 216,
  deal_to_contact: 3,
  note_to_contact: 202,
  note_to_deal: 214,
  note_to_company: 190,
} as const;

// ── Create associations via Nango proxy (HubSpot v4 API) ─────────────────────

async function createAssociations(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  objectType: string,
  objectId: string,
  associations: Array<{ targetType: string; targetId: string; typeId: number }>
): Promise<void> {
  for (const assoc of associations) {
    try {
      await nango.proxy({
        method: "PUT",
        endpoint: `/crm/v4/objects/${objectType}/${objectId}/associations/${assoc.targetType}/${assoc.targetId}`,
        providerConfigKey: "hubspot",
        connectionId,
        data: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: assoc.typeId }],
      });
      console.log(`[skyler-tools] Associated ${objectType}/${objectId} → ${assoc.targetType}/${assoc.targetId} (type ${assoc.typeId})`);
    } catch (err) {
      console.error(`[skyler-tools] Association failed ${objectType}/${objectId} → ${assoc.targetType}/${assoc.targetId}:`,
        err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Build association list from tool input ────────────────────────────────────

function buildAssociationsForTool(
  toolName: string,
  input: Record<string, unknown>
): Array<{ targetType: string; targetId: string; typeId: number }> {
  const assocs: Array<{ targetType: string; targetId: string; typeId: number }> = [];

  if (toolName === "create_task" || toolName === "create_note") {
    const prefix = toolName === "create_task" ? "task" : "note";
    if (input.contact_id) {
      assocs.push({
        targetType: "contacts",
        targetId: input.contact_id as string,
        typeId: ASSOCIATION_TYPES[`${prefix}_to_contact` as keyof typeof ASSOCIATION_TYPES],
      });
    }
    if (input.deal_id) {
      assocs.push({
        targetType: "deals",
        targetId: input.deal_id as string,
        typeId: ASSOCIATION_TYPES[`${prefix}_to_deal` as keyof typeof ASSOCIATION_TYPES],
      });
    }
    if (toolName === "create_task" && input.company_id) {
      assocs.push({
        targetType: "companies",
        targetId: input.company_id as string,
        typeId: ASSOCIATION_TYPES.task_to_company,
      });
    }
    if (toolName === "create_note" && input.company_id) {
      assocs.push({
        targetType: "companies",
        targetId: input.company_id as string,
        typeId: ASSOCIATION_TYPES.note_to_company,
      });
    }
  } else if (toolName === "create_deal") {
    if (input.contact_id) {
      assocs.push({
        targetType: "contacts",
        targetId: input.contact_id as string,
        typeId: ASSOCIATION_TYPES.deal_to_contact,
      });
    }
  }

  return assocs;
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

    // Build context: resolve stage IDs and auto-assign owner for all create tools
    let context: { stageId?: string; ownerId?: string } | undefined;
    const isCreateTool = toolName.startsWith("create_");
    if (toolName === "create_deal" || toolName === "update_deal") {
      const [stageId, ownerId] = await Promise.all([
        input.stage ? resolveStageId(nango, connectionId, input.stage as string) : Promise.resolve(undefined),
        getDefaultOwnerId(nango, connectionId),
      ]);
      context = { stageId, ownerId };
      console.log(`[skyler-tools] Deal context: stageId=${stageId ?? "none"}, ownerId=${ownerId ?? "none"}`);
    } else if (isCreateTool) {
      // Auto-assign owner for all created records (contacts, companies, tasks, notes)
      const ownerId = await getDefaultOwnerId(nango, connectionId);
      context = { ownerId };
      console.log(`[skyler-tools] ${toolName} context: ownerId=${ownerId ?? "none"}`);
    }

    const payload = buildNangoPayload(toolName, input, context);

    // Strip undefined values
    const cleanPayload = JSON.parse(JSON.stringify(payload));

    console.log(`[skyler-tools] Executing ${nangoAction} via Nango — full payload:`, JSON.stringify(cleanPayload));

    const result = await nango.triggerAction(
      "hubspot",
      connectionId,
      nangoAction,
      cleanPayload
    );

    console.log(`[skyler-tools] ${nangoAction} succeeded:`, JSON.stringify(result).slice(0, 300));

    // Post-update: set company phone via proxy (Nango Company model has no phone field)
    if (toolName === "update_company" && input.phone) {
      const companyId = input.company_id as string;
      try {
        await nango.proxy({
          method: "PATCH",
          endpoint: `/crm/v3/objects/companies/${companyId}`,
          providerConfigKey: "hubspot",
          connectionId,
          data: { properties: { phone: input.phone as string } },
        });
        console.log(`[skyler-tools] Set phone on company ${companyId} via proxy`);
      } catch (err) {
        console.error(`[skyler-tools] Failed to set phone on company ${companyId}:`,
          err instanceof Error ? err.message : String(err));
      }
    }

    // Post-creation: associate with contacts/companies/deals via HubSpot v4 API
    const createdId = (result as Record<string, unknown>)?.id as string | undefined;
    if (createdId) {
      const associations = buildAssociationsForTool(toolName, input);
      if (associations.length > 0) {
        const objectType = toolName.includes("task") ? "tasks"
          : toolName.includes("note") ? "notes"
          : toolName.includes("deal") ? "deals"
          : null;
        if (objectType) {
          await createAssociations(nango, connectionId, objectType, createdId, associations);
        }
      }
    }

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

// ── Handle execute/reject pending action tools ───────────────────────────

async function handleActionTool(
  toolName: string,
  input: Record<string, unknown>,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  const actionId = input.action_id as string;
  if (!actionId) {
    return { results: [], summary: "Missing action_id parameter." };
  }

  if (toolName === "execute_pending_action") {
    const result = await executeApprovedAction(actionId, adminSupabase);
    if (!result.success) {
      return { results: [], summary: `Failed to execute action: ${result.error}` };
    }
    // Fetch the action description for the confirmation message
    const { data: action } = await adminSupabase
      .from("skyler_actions")
      .select("description")
      .eq("id", actionId)
      .single();
    const desc = action?.description ?? "action";
    return {
      results: [],
      summary: `[ACTION_EXECUTED] ${desc}\n\nAction executed successfully.`,
    };
  }

  if (toolName === "reject_pending_action") {
    const result = await rejectAction(actionId, adminSupabase);
    if (!result.success) {
      return { results: [], summary: `Failed to reject action: ${result.error}` };
    }
    return { results: [], summary: "Action rejected and cancelled." };
  }

  return { results: [], summary: `Unknown action tool: ${toolName}` };
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
  // ── Action management tools: execute/reject pending actions ──────────
  if (SKYLER_ACTION_TOOL_NAMES.has(toolName)) {
    return handleActionTool(toolName, input, adminSupabase);
  }

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

  // ── APPROVAL REQUIRED: save pending action (with dedup) ─────────────
  if (autonomyLevel === "approval_required") {
    // Dedup: check for existing pending action with same tool_name and matching key inputs
    const { data: existingActions } = await adminSupabase
      .from("skyler_actions")
      .select("id, description, tool_input")
      .eq("workspace_id", workspaceId)
      .eq("tool_name", toolName)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);

    const existingDup = (existingActions ?? []).find((existing: { id: string; tool_input: Record<string, unknown> }) => {
      const ei = existing.tool_input ?? {};
      // Match on key identifying fields based on tool type
      switch (toolName) {
        case "create_contact":
          return ei.first_name === input.first_name && ei.last_name === input.last_name
            && (ei.email === input.email || (!ei.email && !input.email));
        case "update_contact":
          return ei.contact_id === input.contact_id;
        case "create_company":
          return ei.name === input.name;
        case "update_company":
          return ei.company_id === input.company_id;
        case "create_deal":
          return ei.deal_name === input.deal_name;
        case "update_deal":
          return ei.deal_id === input.deal_id;
        case "create_task":
          return ei.subject === input.subject;
        case "create_note":
          return ei.body === input.body;
        default:
          return JSON.stringify(ei) === JSON.stringify(input);
      }
    });

    if (existingDup) {
      console.log(`[skyler-tools] Dedup: reusing existing pending action ${existingDup.id}`);
      return {
        results: [],
        summary: `[ACTION_PENDING:${existingDup.id}] ${description}\n\nThis action is already drafted and awaiting your approval.`,
      };
    }

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

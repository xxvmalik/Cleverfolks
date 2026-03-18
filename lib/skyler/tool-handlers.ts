/**
 * Skyler's tool handler — wraps read tools (delegated to CleverBrain handlers)
 * and write tools with 3-level autonomy enforcement.
 */

import { Nango } from "@nangohq/node";
import {
  executeToolCall as executeReadToolCall,
  type ToolHandlerResult,
} from "@/lib/cleverbrain/tool-handlers";
import { SKYLER_WRITE_TOOL_NAMES, SKYLER_LEAD_TOOL_NAMES, SKYLER_SALES_CLOSER_TOOL_NAMES, SKYLER_ACTION_TOOL_NAMES, SKYLER_CALENDAR_TOOL_NAMES } from "@/lib/skyler/tools";
import { scoreLead, type LeadScoreResult } from "@/lib/skyler/lead-scoring";
import { pickupExistingConversation } from "@/lib/skyler/conversation-pickup";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { draftEmail } from "@/lib/skyler/email-drafter";
import type { CompanyResearch } from "@/lib/skyler/company-research";
import { getSalesVoice } from "@/lib/skyler/voice-learner";
import { buildSalesPlaybook } from "@/lib/skyler/sales-playbook";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";
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

    // ── update_company: separate phone (proxy-only) from other fields (Nango) ──
    let result: unknown;
    if (toolName === "update_company") {
      const hasPhone = !!input.phone;
      const hasOtherFields = Object.keys(input).some(
        (k) => k !== "company_id" && k !== "phone" && input[k] !== undefined && input[k] !== null && input[k] !== ""
      );

      // 1. Nango update for non-phone fields (skip if phone is the only field)
      if (hasOtherFields) {
        const payload = buildNangoPayload(toolName, input, context);
        const cleanPayload = JSON.parse(JSON.stringify(payload));
        console.log(`[skyler-tools] Executing ${nangoAction} via Nango — full payload:`, JSON.stringify(cleanPayload));
        result = await nango.triggerAction("hubspot", connectionId, nangoAction, cleanPayload);
        console.log(`[skyler-tools] ${nangoAction} succeeded:`, JSON.stringify(result).slice(0, 300));
      } else {
        console.log(`[skyler-tools] update_company: only phone field — skipping Nango action`);
        result = { id: input.company_id };
      }

      // 2. Phone via direct HubSpot proxy (Nango Company model has no phone field)
      if (hasPhone) {
        const companyId = input.company_id as string;
        try {
          await nango.proxy({
            method: "PATCH",
            baseUrlOverride: "https://api.hubapi.com",
            endpoint: `/crm/v3/objects/companies/${companyId}`,
            providerConfigKey: "hubspot",
            connectionId,
            headers: { "Content-Type": "application/json" },
            data: { properties: { phone: input.phone as string } },
            retries: 3,
          });
          console.log(`[skyler-tools] Set phone on company ${companyId} via proxy`);
        } catch (err: unknown) {
          const errObj = err as { response?: { status?: number; data?: unknown }; message?: string };
          console.error(`[skyler-tools] Failed to set phone on company ${companyId}:`,
            JSON.stringify({
              status: errObj?.response?.status,
              data: errObj?.response?.data,
              message: errObj?.message ?? String(err),
            }).slice(0, 500));
        }
      }
    } else {
      // ── All other tools: normal Nango action ──
      const payload = buildNangoPayload(toolName, input, context);
      const cleanPayload = JSON.parse(JSON.stringify(payload));
      console.log(`[skyler-tools] Executing ${nangoAction} via Nango — full payload:`, JSON.stringify(cleanPayload));
      result = await nango.triggerAction("hubspot", connectionId, nangoAction, cleanPayload);
      console.log(`[skyler-tools] ${nangoAction} succeeded:`, JSON.stringify(result).slice(0, 300));
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
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  // draft_correction_email has different params — handle separately
  if (toolName === "draft_correction_email") {
    return handleDraftCorrectionEmail(input, workspaceId, adminSupabase);
  }

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

// ── Handle draft correction email ─────────────────────────────────────────────
// Routes through the full email-drafter engine so the draft gets:
// sender identity, playbook, voice, knowledge profile, conversation thread,
// word limits, no-emoji rules, and all other guardrails.

async function handleDraftCorrectionEmail(
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  const pipelineId = input.pipeline_id as string;
  const userFeedback = input.user_feedback as string;

  if (!pipelineId) {
    return { results: [], summary: "Missing required parameter: pipeline_id." };
  }

  try {
    // 1. Fetch pipeline record
    const { data: pipeline } = await adminSupabase
      .from("skyler_sales_pipeline")
      .select("*")
      .eq("id", pipelineId)
      .single();

    if (!pipeline) {
      return { results: [], summary: `Pipeline record ${pipelineId} not found.` };
    }

    const contactName = pipeline.contact_name as string;
    const contactEmail = pipeline.contact_email as string;
    const companyName = pipeline.company_name as string;
    const thread = (pipeline.conversation_thread ?? []) as Array<{
      role: string;
      content: string;
      subject?: string;
      timestamp: string;
    }>;

    // 2. Load sender identity (workspace owner)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberData } = await adminSupabase
      .from("workspace_memberships")
      .select("profiles(full_name)")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .limit(1)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prof = (memberData as any)?.profiles;
    const senderName: string | null = Array.isArray(prof)
      ? prof[0]?.full_name
      : prof?.full_name ?? null;

    const { data: ws } = await adminSupabase
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();
    const settings = (ws?.settings ?? {}) as Record<string, unknown>;
    const senderCompany = (settings.company_name as string) ?? null;

    // 3. Load knowledge profile
    const { data: kpData } = await adminSupabase
      .from("knowledge_profiles")
      .select("profile, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const knowledgeProfile =
      kpData?.profile && ["ready", "pending_review"].includes(kpData.status ?? "")
        ? (kpData.profile as Record<string, unknown>)
        : null;

    // 4. Load workspace memories + build playbook
    const { data: memRows } = await adminSupabase
      .from("workspace_memories")
      .select("content")
      .eq("workspace_id", workspaceId)
      .is("superseded_by", null)
      .order("times_reinforced", { ascending: false })
      .limit(20);
    const rawMemories = (memRows ?? []).map((m) => m.content as string);
    const memories = filterDealMemories(rawMemories);

    const playbook = await buildSalesPlaybook(adminSupabase, workspaceId, memories, knowledgeProfile);

    // 5. Load sales voice
    const voice = await getSalesVoice(adminSupabase, workspaceId);

    // 6. Load cached company research from pipeline record (or minimal fallback)
    let research: CompanyResearch;
    if (pipeline.company_research) {
      research = pipeline.company_research as unknown as CompanyResearch;
    } else {
      // Minimal fallback — don't block on full research for a correction
      research = {
        summary: `${companyName} — limited research available`,
        industry: "Unknown",
        estimated_size: "Unknown",
        trigger_event: "",
        pain_points: [],
        recent_news: [],
        decision_makers: [],
        talking_points: [],
        service_alignment_points: [],
        website_insights: "",
        researched_at: new Date().toISOString(),
        confidence: "low" as const,
        confidence_reason: "No cached research — using fallback for correction draft",
      };
    }

    // 7. Draft via the full email engine
    console.log(`[draft_correction_email] Routing through email drafter for ${contactName} (pipeline: ${pipelineId})`);
    const draft = await draftEmail({
      workspaceId,
      pipelineRecord: {
        id: pipelineId,
        contact_name: contactName,
        contact_email: contactEmail,
        company_name: companyName,
        stage: pipeline.stage as string,
        cadence_step: pipeline.cadence_step as number,
        conversation_thread: thread,
      },
      cadenceStep: thread.length > 0 ? -1 : 1, // Reply mode if thread exists, else initial
      companyResearch: research,
      salesVoice: voice,
      conversationThread: thread,
      workspaceMemories: memories,
      salesPlaybook: playbook,
      knowledgeProfile,
      senderName: senderName ?? undefined,
      senderCompany: senderCompany ?? undefined,
      replyIntent: thread.length > 0 ? "positive_interest" : undefined,
      userFeedback: userFeedback || undefined,
    });

    // 8. Store as pending action for approval
    const { actionId } = await draftOutreachEmail(adminSupabase, {
      workspaceId,
      pipelineId,
      to: contactEmail,
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      textBody: draft.textBody,
    });

    return {
      results: [],
      summary: `[ACTION_PROPOSED] Draft correction email created for ${contactEmail}: "${draft.subject}"\n\nI've drafted a corrected email for your approval. You can preview and approve it on the pipeline card.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[draft_correction_email] Error:`, msg);
    return { results: [], summary: `Failed to create draft: ${msg}` };
  }
}

// ── Handle lead scoring tools ─────────────────────────────────────────────────

async function handleLeadTool(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  if (toolName === "score_lead") {
    const contactId = input.contact_id as string;
    if (!contactId) {
      return { results: [], summary: "Missing contact_id parameter." };
    }
    try {
      const result = await scoreLead(adminSupabase, workspaceId, contactId, {
        forceRescore: (input.force_rescore as boolean) ?? false,
      });
      if (!result) {
        return {
          results: [],
          summary: `Contact ${contactId} has already been scored. Use force_rescore: true to rescore.`,
        };
      }
      return {
        results: [],
        summary: formatLeadScoreResult(result),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[skyler-tools] score_lead failed:", msg);
      return { results: [], summary: `Failed to score lead: ${msg}` };
    }
  }

  if (toolName === "get_lead_scores") {
    const classification = (input.classification as string) ?? "all";
    const limit = (input.limit as number) ?? 20;

    try {
      let query = adminSupabase
        .from("lead_scores")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("total_score", { ascending: false })
        .limit(limit);

      if (classification !== "all") {
        query = query.eq("classification", classification);
      }

      const { data: leads, error } = await query;
      if (error) throw error;
      if (!leads || leads.length === 0) {
        return {
          results: [],
          summary: classification === "all"
            ? "No leads have been scored yet. Use score_lead to score individual contacts, or they will be auto-scored when synced."
            : `No leads with classification "${classification}" found.`,
        };
      }

      const lines = leads.map((l: Record<string, unknown>) => {
        const dims = l.dimension_scores as Record<string, { score: number }> | null;
        const dimSummary = dims
          ? Object.entries(dims).map(([k, v]) => `${k}: ${v.score}`).join(", ")
          : "no dimensions";
        const referral = l.is_referral ? ` | Referral from ${l.referrer_name ?? "unknown"}` : "";
        return `- ${l.contact_name ?? "Unknown"} (${l.contact_email ?? "no email"}) | ${l.company_name ?? "no company"} | Score: ${l.total_score}/100 [${(l.classification as string).toUpperCase()}] | ${dimSummary}${referral}`;
      });

      const header = classification === "all"
        ? `Found ${leads.length} scored leads:`
        : `Found ${leads.length} "${classification}" leads:`;

      return { results: [], summary: `${header}\n${lines.join("\n")}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[skyler-tools] get_lead_scores failed:", msg);
      return { results: [], summary: `Failed to retrieve lead scores: ${msg}` };
    }
  }

  return { results: [], summary: `Unknown lead tool: ${toolName}` };
}

// ── Handle Sales Closer tools ─────────────────────────────────────────────────

async function handleSalesCloserTool(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  if (toolName === "get_sales_pipeline") {
    const stage = (input.stage as string) ?? "all";
    const limit = (input.limit as number) ?? 20;

    let query = adminSupabase
      .from("skyler_sales_pipeline")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (stage !== "all") query = query.eq("stage", stage);

    const { data, error } = await query;
    if (error) return { results: [], summary: `Failed to fetch pipeline: ${error.message}` };
    if (!data || data.length === 0) {
      return { results: [], summary: "No leads in the sales pipeline yet. Use move_to_sales_closer to add leads, or enable Sales Closer to automatically work hot leads." };
    }

    const lines = data.map((r: Record<string, unknown>) => {
      const emails = `${r.emails_sent ?? 0} sent, ${r.emails_opened ?? 0} opened, ${r.emails_replied ?? 0} replied`;
      return `- ${r.contact_name} (${r.contact_email}) | ${r.company_name ?? "no company"} | Stage: ${r.stage} | ${emails}${r.resolution ? ` | Resolution: ${r.resolution}` : ""}`;
    });

    return { results: [], summary: `Sales Pipeline (${data.length} records):\n${lines.join("\n")}` };
  }

  if (toolName === "get_performance_metrics") {
    const { data } = await adminSupabase
      .from("skyler_sales_pipeline")
      .select("emails_sent, emails_opened, emails_replied, resolution, stage")
      .eq("workspace_id", workspaceId);

    const all = data ?? [];
    if (all.length === 0) {
      return { results: [], summary: "No performance data yet. The sales pipeline is empty." };
    }

    const totalLeads = all.length;
    const sent = all.reduce((s, r) => s + ((r.emails_sent as number) ?? 0), 0);
    const opened = all.reduce((s, r) => s + ((r.emails_opened as number) ?? 0), 0);
    const replied = all.reduce((s, r) => s + ((r.emails_replied as number) ?? 0), 0);
    const meetings = all.filter((r) => r.resolution === "meeting_booked").length;
    const demos = all.filter((r) => r.resolution === "demo_booked").length;
    const payments = all.filter((r) => r.resolution === "payment_secured").length;
    const won = all.filter((r) => r.stage === "closed_won").length;

    const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
    const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;

    return {
      results: [],
      summary: `Sales Performance:\n- Leads in pipeline: ${totalLeads}\n- Emails sent: ${sent}\n- Open rate: ${openRate}%\n- Reply rate: ${replyRate}%\n- Meetings booked: ${meetings}\n- Demos booked: ${demos}\n- Payments secured: ${payments}\n- Deals won: ${won}`,
    };
  }

  if (toolName === "move_to_sales_closer") {
    const contactEmail = input.contact_email as string;
    if (!contactEmail) return { results: [], summary: "Missing contact_email parameter." };

    // Check if already in pipeline
    const { data: existing } = await adminSupabase
      .from("skyler_sales_pipeline")
      .select("id, stage")
      .eq("workspace_id", workspaceId)
      .eq("contact_email", contactEmail)
      .single();

    if (existing) {
      return { results: [], summary: `${contactEmail} is already in the sales pipeline at stage: ${existing.stage}` };
    }

    const website = (input.website as string) ?? null;
    const userContext = (input.user_context as string) ?? null;

    const { data, error } = await adminSupabase
      .from("skyler_sales_pipeline")
      .insert({
        workspace_id: workspaceId,
        contact_id: (input.contact_id as string) ?? contactEmail,
        contact_name: (input.contact_name as string) ?? contactEmail,
        contact_email: contactEmail,
        company_name: (input.company_name as string) ?? null,
        website,
        user_context: userContext,
        stage: "initial_outreach",
      })
      .select("id")
      .single();

    if (error) return { results: [], summary: `Failed to add to pipeline: ${error.message}` };

    // Trigger Sales Closer workflow
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "skyler/lead.qualified.hot",
      data: {
        contactId: (input.contact_id as string) ?? contactEmail,
        contactEmail,
        contactName: (input.contact_name as string) ?? contactEmail,
        companyName: (input.company_name as string) ?? null,
        website,
        userContext,
        workspaceId,
        leadScoreId: null,
        pipelineId: data!.id,
      },
    });

    return {
      results: [],
      summary: `Added ${input.contact_name ?? contactEmail} to the Sales Closer pipeline. I will research their company and draft an outreach email for your approval.`,
    };
  }

  if (toolName === "pickup_conversation") {
    const contactEmail = input.contact_email as string;
    if (!contactEmail) return { results: [], summary: "Missing contact_email parameter." };

    try {
      const context = await pickupExistingConversation({
        workspaceId,
        contactEmail,
        contactName: input.contact_name as string | undefined,
        contactId: input.contact_id as string | undefined,
        companyName: input.company_name as string | undefined,
        db: adminSupabase,
        createPipelineRecord: true,
      });

      const lines = [
        `Conversation Pickup for ${input.contact_name ?? contactEmail}:`,
        `Summary: ${context.summary}`,
        `Emails found: ${context.email_count}`,
        `Last message from: ${context.last_message_from}`,
        `Awaiting our response: ${context.awaiting_response ? "YES" : "No"}`,
        `Tone: ${context.tone_of_conversation}`,
      ];
      if (context.key_topics.length > 0) lines.push(`Topics: ${context.key_topics.join(", ")}`);
      if (context.open_questions.length > 0) lines.push(`Open questions: ${context.open_questions.join("; ")}`);
      lines.push(`Suggested next action: ${context.suggested_next_action}`);

      return { results: [], summary: lines.join("\n") };
    } catch (err) {
      return { results: [], summary: `Failed to pick up conversation: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { results: [], summary: `Unknown sales closer tool: ${toolName}` };
}

function formatLeadScoreResult(r: LeadScoreResult): string {
  const dims = Object.entries(r.dimension_scores)
    .map(([k, v]) => `  ${k}: ${v.score}/25 — ${v.reasoning}`)
    .join("\n");
  const referral = r.is_referral
    ? `\nReferral: Yes (from ${r.referrer_name ?? "unknown"}${r.referrer_company ? ` at ${r.referrer_company}` : ""})`
    : "";
  return `Lead Score for ${r.contact_name} (${r.contact_email}):
Company: ${r.company_name}
Total Score: ${r.total_score}/100
Classification: ${r.classification.toUpperCase()}
${dims}${referral}
${r.scoring_reasoning}`;
}

// ── Calendar tool handlers ───────────────────────────────────────────────────

async function handleCalendarTool(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  switch (toolName) {
    case "check_calendar_availability":
      return handleCheckAvailability(input, workspaceId, adminSupabase);
    case "create_calendar_event":
      return handleCreateCalendarEvent(input, workspaceId, adminSupabase);
    case "get_booking_link":
      return handleGetBookingLink(input, workspaceId, adminSupabase);
    default:
      return { results: [], summary: `Unknown calendar tool: ${toolName}` };
  }
}

async function handleCheckAvailability(
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  const durationMinutes = (input.duration_minutes as number) ?? 30;
  const daysToCheck = (input.days_to_check as number) ?? 5;

  try {
    // Try calendar_connections first, fall back to integrations table
    const { getAvailableSlots, scoreTimeSlots } = await import("@/lib/skyler/calendar/calendar-service");

    const now = new Date();
    const endDate = new Date(now.getTime() + daysToCheck * 24 * 60 * 60 * 1000);

    let slots = await getAvailableSlots(
      workspaceId,
      now.toISOString(),
      endDate.toISOString(),
      durationMinutes
    );

    // Fallback: if calendar_connections is empty, try Outlook via integrations table
    if (!slots) {
      slots = await getOutlookSlotsViaIntegrations(
        workspaceId,
        adminSupabase,
        now,
        endDate,
        durationMinutes
      );
    }

    if (!slots || slots.length === 0) {
      return {
        results: [],
        summary: "No calendar is connected, or no free slots found in the requested range. You can ask the lead for their availability instead.",
      };
    }

    const scored = scoreTimeSlots(slots);
    const allScored = [...slots].sort((a, b) => b.score - a.score).slice(0, 10);

    const formatSlot = (s: { start: string; end: string; score: number }) => {
      const d = new Date(s.start);
      const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      const startTime = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const endTime = new Date(s.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${day}, ${startTime}–${endTime} (score: ${s.score})`;
    };

    const topSection = scored.map((s, i) => `${i + 1}. ${formatSlot(s)}`).join("\n");
    const otherSection = allScored
      .filter((s) => !scored.some((t) => t.start === s.start))
      .slice(0, 5)
      .map((s) => `  - ${formatSlot(s)}`)
      .join("\n");

    return {
      results: [],
      summary: `Calendar availability (${durationMinutes}-min slots, next ${daysToCheck} business days):\n\nTop recommended slots:\n${topSection}${otherSection ? `\n\nOther available:\n${otherSection}` : ""}\n\nTotal free slots found: ${slots.length}`,
    };
  } catch (err) {
    console.error("[check_calendar_availability] Error:", err instanceof Error ? err.message : err);
    return {
      results: [],
      summary: `Failed to check calendar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleCreateCalendarEvent(
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  const title = input.title as string;
  const startTime = input.start_time as string;
  const endTime = input.end_time as string;
  const leadEmail = input.lead_email as string;
  const leadName = (input.lead_name as string) ?? leadEmail;
  const pipelineId = input.pipeline_id as string | undefined;
  const additionalAttendees = (input.additional_attendees as string[]) ?? [];
  const description = (input.description as string) ?? "";

  if (!title || !startTime || !endTime || !leadEmail) {
    return {
      results: [],
      summary: "Missing required fields: title, start_time, end_time, and lead_email are all required.",
    };
  }

  try {
    const { createMeetingEvent, scheduleRecallBot } = await import("@/lib/skyler/calendar/calendar-service");

    const allAttendees = [leadEmail, ...additionalAttendees];

    const event = await createMeetingEvent(workspaceId, {
      summary: title,
      startDateTime: startTime,
      endDateTime: endTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      attendeeEmails: allAttendees,
      description,
      leadId: pipelineId,
    });

    if (!event) {
      // Fallback: try creating via integrations table (Outlook)
      const fallbackEvent = await createOutlookEventViaIntegrations(
        workspaceId,
        adminSupabase,
        { title, startTime, endTime, attendeeEmails: allAttendees, description, pipelineId }
      );
      if (!fallbackEvent) {
        return {
          results: [],
          summary: "No calendar is connected. Cannot create a calendar event. You can ask the lead for their availability instead.",
        };
      }
      return {
        results: [],
        summary: `Meeting created!\n- Title: ${title}\n- Time: ${formatEventTime(startTime, endTime)}\n- Attendees: ${allAttendees.join(", ")}\n- Meeting link: ${fallbackEvent.meetingUrl ?? "No video link (Teams may not be enabled)"}\n- Provider: Outlook`,
      };
    }

    // Schedule Recall bot if meeting intelligence is enabled
    if (event.meetingUrl) {
      scheduleRecallBot(workspaceId, event.id, event.meetingUrl).catch(() => {});
    }

    // Update pipeline stage if we have a pipeline ID
    if (pipelineId) {
      await adminSupabase
        .from("skyler_sales_pipeline")
        .update({
          stage: "meeting_booked",
          meeting_event_id: event.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineId);
    }

    return {
      results: [],
      summary: `Meeting created!\n- Title: ${title}\n- Time: ${formatEventTime(startTime, endTime)}\n- Attendees: ${allAttendees.join(", ")}\n- Meeting link: ${event.meetingUrl ?? "No video link"}\n- Provider: ${event.provider === "microsoft_outlook" ? "Outlook + Teams" : "Google Calendar + Meet"}`,
    };
  } catch (err) {
    console.error("[create_calendar_event] Error:", err instanceof Error ? err.message : err);
    return {
      results: [],
      summary: `Failed to create calendar event: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleGetBookingLink(
  input: Record<string, unknown>,
  workspaceId: string,
  _adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  try {
    const { getCalendlyConnection } = await import("@/lib/skyler/calendar/calendar-service");
    const calendlyConn = await getCalendlyConnection(workspaceId);

    if (!calendlyConn) {
      // Also check integrations table
      const { data: integration } = await _adminSupabase
        .from("integrations")
        .select("nango_connection_id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "calendly")
        .eq("status", "connected")
        .single();

      if (!integration) {
        return {
          results: [],
          summary: "No Calendly connection found. You can suggest specific times from the calendar instead, or ask the lead for their availability.",
        };
      }

      // Has Calendly in integrations — try to get event types
      try {
        const { listEventTypes, getCurrentUser, createSchedulingLink } = await import("@/lib/skyler/calendar/calendly-client");
        const user = await getCurrentUser({ workspaceId, connectionId: integration.nango_connection_id });
        const eventTypes = await listEventTypes({ workspaceId, connectionId: integration.nango_connection_id }, user.uri);

        if (eventTypes.length === 0) {
          return { results: [], summary: "Calendly is connected but no active event types found. Create an event type in Calendly first." };
        }

        // Pick the first active event type (or a 30-min one if available)
        const preferred = eventTypes.find((e) => e.duration === 30) ?? eventTypes[0];
        const link = await createSchedulingLink({ workspaceId, connectionId: integration.nango_connection_id }, preferred.uri);

        return {
          results: [],
          summary: `Calendly booking link generated:\n- Event type: ${preferred.name} (${preferred.duration} min)\n- Link: ${link.booking_url}\n\nThis is a one-time link.`,
        };
      } catch (err) {
        return {
          results: [],
          summary: `Calendly is connected but failed to generate link: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Use calendar_connections-based Calendly
    const eventTypes = (calendlyConn.calendly_event_types ?? []) as Array<{ uri: string; name: string; duration: number; scheduling_url: string }>;
    if (eventTypes.length === 0) {
      return { results: [], summary: "Calendly is connected but no event types are configured." };
    }

    const preferred = eventTypes.find((e) => e.duration === 30) ?? eventTypes[0];
    return {
      results: [],
      summary: `Calendly booking link:\n- Event type: ${preferred.name} (${preferred.duration} min)\n- Link: ${preferred.scheduling_url}`,
    };
  } catch (err) {
    console.error("[get_booking_link] Error:", err instanceof Error ? err.message : err);
    return {
      results: [],
      summary: `Failed to get booking link: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Calendar helper: Outlook via integrations table fallback ─────────────────

async function getOutlookSlotsViaIntegrations(
  workspaceId: string,
  adminSupabase: AdminDb,
  start: Date,
  end: Date,
  durationMinutes: number
): Promise<Array<{ start: string; end: string; score: number }> | null> {
  const { Nango } = await import("@nangohq/node");

  const { data: integration } = await adminSupabase
    .from("integrations")
    .select("nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .single();

  if (!integration?.nango_connection_id) return null;

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const connectionId = integration.nango_connection_id;

  // Get user email
  let userEmail = "";
  try {
    const meResp = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com/v1.0",
      endpoint: "/me",
      providerConfigKey: "outlook",
      connectionId,
    });
    const me = meResp.data as Record<string, unknown>;
    userEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? "";
  } catch {
    return null;
  }

  if (!userEmail) return null;

  // Get schedule + working hours
  try {
    const resp = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://graph.microsoft.com/v1.0",
      endpoint: "/me/calendar/getSchedule",
      providerConfigKey: "outlook",
      connectionId,
      data: {
        schedules: [userEmail],
        startTime: { dateTime: start.toISOString(), timeZone: "UTC" },
        endTime: { dateTime: end.toISOString(), timeZone: "UTC" },
        availabilityViewInterval: durationMinutes,
      },
    });

    const availability = resp.data as { value?: Array<{ scheduleItems?: Array<{ start: { dateTime: string }; end: { dateTime: string } }>; workingHours?: { startTime?: string; endTime?: string; daysOfWeek?: string[] } }> };
    const scheduleData = availability.value?.[0] ?? {};
    const busyBlocks = (scheduleData.scheduleItems ?? []).map((b) => ({
      start: b.start.dateTime,
      end: b.end.dateTime,
    }));

    const wh = scheduleData.workingHours;
    const workStart = wh?.startTime ?? "09:00";
    const workEnd = wh?.endTime ?? "17:00";
    const dayNames = wh?.daysOfWeek ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const dayMap: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
    const workDays = dayNames.map((d) => dayMap[d.toLowerCase()] ?? 0).filter(Boolean);

    // Invert busy blocks to free slots
    return invertBusyToFreeSlots(busyBlocks, start, end, durationMinutes, workStart, workEnd, workDays);
  } catch {
    return null;
  }
}

async function createOutlookEventViaIntegrations(
  workspaceId: string,
  adminSupabase: AdminDb,
  eventData: { title: string; startTime: string; endTime: string; attendeeEmails: string[]; description?: string; pipelineId?: string }
): Promise<{ meetingUrl: string | null; eventId: string } | null> {
  const { Nango } = await import("@nangohq/node");

  const { data: integration } = await adminSupabase
    .from("integrations")
    .select("nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .single();

  if (!integration?.nango_connection_id) return null;

  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Get user timezone
  let timeZone = "UTC";
  try {
    const tzResp = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com/v1.0",
      endpoint: "/me/mailboxSettings",
      providerConfigKey: "outlook",
      connectionId: integration.nango_connection_id,
    });
    timeZone = (tzResp.data as Record<string, unknown>).timeZone as string ?? "UTC";
  } catch { /* fallback UTC */ }

  const resp = await nango.proxy({
    method: "POST",
    baseUrlOverride: "https://graph.microsoft.com/v1.0",
    endpoint: "/me/events",
    providerConfigKey: "outlook",
    connectionId: integration.nango_connection_id,
    data: {
      subject: eventData.title,
      body: eventData.description ? { contentType: "HTML", content: eventData.description } : undefined,
      start: { dateTime: eventData.startTime, timeZone },
      end: { dateTime: eventData.endTime, timeZone },
      attendees: eventData.attendeeEmails.map((email) => ({
        emailAddress: { address: email, name: email },
        type: "required",
      })),
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    },
  });

  const event = resp.data as Record<string, unknown>;
  const onlineMeeting = event.onlineMeeting as Record<string, unknown> | null;
  const meetingUrl = (onlineMeeting?.joinUrl as string) ?? null;

  // Store in calendar_events for tracking
  await adminSupabase.from("calendar_events").insert({
    workspace_id: workspaceId,
    provider: "microsoft_outlook",
    provider_event_id: event.id as string,
    title: eventData.title,
    description: eventData.description,
    start_time: eventData.startTime,
    end_time: eventData.endTime,
    timezone: timeZone,
    meeting_url: meetingUrl,
    meeting_provider: "teams",
    attendees: eventData.attendeeEmails.map((e) => ({ email: e, response_status: "none" })),
    status: "confirmed",
    lead_id: eventData.pipelineId,
  });

  return { meetingUrl, eventId: event.id as string };
}

function invertBusyToFreeSlots(
  busyBlocks: Array<{ start: string; end: string }>,
  rangeStart: Date,
  rangeEnd: Date,
  durationMinutes: number,
  workStart: string,
  workEnd: string,
  workDays: number[]
): Array<{ start: string; end: string; score: number }> {
  const slots: Array<{ start: string; end: string; score: number }> = [];
  const durationMs = durationMinutes * 60 * 1000;
  const sorted = [...busyBlocks].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const current = new Date(rangeStart);
  current.setUTCHours(0, 0, 0, 0);

  while (current < rangeEnd) {
    const dayOfWeek = current.getUTCDay();
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    if (workDays.includes(isoDay)) {
      const [sH, sM] = workStart.split(":").map(Number);
      const [eH, eM] = workEnd.split(":").map(Number);
      const dayStart = new Date(current);
      dayStart.setUTCHours(sH, sM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setUTCHours(eH, eM, 0, 0);
      if (dayEnd.getTime() > Date.now()) {
        let cursor = Math.max(dayStart.getTime(), Date.now());
        const dayBusy = sorted.filter((b) => {
          const bs = new Date(b.start).getTime();
          const be = new Date(b.end).getTime();
          return be > dayStart.getTime() && bs < dayEnd.getTime();
        });
        for (const block of dayBusy) {
          const blockStart = new Date(block.start).getTime();
          while (cursor + durationMs <= blockStart && cursor + durationMs <= dayEnd.getTime()) {
            slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString(), score: 0 });
            cursor += durationMs;
          }
          cursor = Math.max(cursor, new Date(block.end).getTime());
        }
        while (cursor + durationMs <= dayEnd.getTime()) {
          slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString(), score: 0 });
          cursor += durationMs;
        }
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return slots;
}

function formatEventTime(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const startTime = s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endTime = e.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${startTime}–${endTime}`;
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
    return handleActionTool(toolName, input, workspaceId, adminSupabase);
  }

  // ── Lead scoring tools: no autonomy check needed (read-like) ──────────
  if (SKYLER_LEAD_TOOL_NAMES.has(toolName)) {
    return handleLeadTool(toolName, input, workspaceId, adminSupabase);
  }

  // ── Sales Closer tools: no autonomy check (read-like + pipeline management) ──
  if (SKYLER_SALES_CLOSER_TOOL_NAMES.has(toolName)) {
    return handleSalesCloserTool(toolName, input, workspaceId, adminSupabase);
  }

  // ── Calendar tools: check availability, create events, get booking links ──
  if (SKYLER_CALENDAR_TOOL_NAMES.has(toolName)) {
    return handleCalendarTool(toolName, input, workspaceId, adminSupabase);
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

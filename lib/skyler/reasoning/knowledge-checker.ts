/**
 * Knowledge Checker — Pre-generation knowledge gap detection.
 *
 * Before Skyler drafts any content, this deterministic (no AI) check validates
 * that she has the data she needs. If critical fields are missing, the reasoning
 * step is skipped entirely and request_info fires instead. This saves an API
 * call AND prevents fabrication.
 *
 * Task schemas are extensible — adding a new document type just needs a new
 * entry in TASK_SCHEMAS.
 */

import type { AgentMemory } from "@/lib/skyler/memory/agent-memory-store";
import type { PipelineRecord } from "./context-assembler";
import type { SkylerWorkflowSettings } from "@/app/api/skyler/workflow-settings/route";

// ── Types ────────────────────────────────────────────────────────────────────

export type FieldSource = "pipeline_record" | "agent_memories" | "workflow_settings" | "calendar_connection";

export type RequiredField = {
  /** Human-readable name (shown when requesting info) */
  field: string;
  /** Where to look for this data */
  source: FieldSource;
  /** JSON path or key to check */
  path: string;
  /** If true, missing this field ALWAYS triggers request_info regardless of score */
  critical?: boolean;
};

export type TaskSchema = {
  required: RequiredField[];
  optional: RequiredField[];
};

export type KnowledgeCheckResult = {
  isComplete: boolean;
  missingFields: string[];
  completenessScore: number;
  /** Human-readable description of what's missing */
  requestDescription: string;
  /** When true, Skyler drafted despite gaps — send to approval queue with warning */
  draftedWithGaps?: boolean;
  /** Warning message for the approval queue when drafted with gaps */
  gapWarning?: string;
};

// ── Task Schemas ─────────────────────────────────────────────────────────────

const TASK_SCHEMAS: Record<string, TaskSchema> = {
  draft_invoice: {
    required: [
      { field: "company_name", source: "pipeline_record", path: "company_name" },
      { field: "payment_methods", source: "agent_memories", path: "payment_methods", critical: true },
      { field: "pricing_agreed", source: "pipeline_record", path: "deal_value" },
    ],
    optional: [
      { field: "billing_address", source: "agent_memories", path: "billing_address" },
      { field: "po_number", source: "agent_memories", path: "po_number" },
      { field: "billing_contact_email", source: "pipeline_record", path: "contact_email" },
      { field: "legal_entity_name", source: "agent_memories", path: "legal_entity_name" },
    ],
  },

  draft_proposal: {
    required: [
      { field: "company_name", source: "pipeline_record", path: "company_name" },
      { field: "pricing_structure", source: "workflow_settings", path: "pricingStructure" },
    ],
    optional: [
      { field: "case_studies", source: "agent_memories", path: "case_studies" },
      { field: "competitor_context", source: "agent_memories", path: "competitor_info" },
    ],
  },

  draft_contract: {
    required: [
      { field: "company_name", source: "pipeline_record", path: "company_name" },
      { field: "legal_entity_name", source: "agent_memories", path: "legal_entity_name", critical: true },
      { field: "pricing_agreed", source: "pipeline_record", path: "deal_value" },
      { field: "payment_terms", source: "agent_memories", path: "payment_terms", critical: true },
    ],
    optional: [
      { field: "governing_law", source: "agent_memories", path: "governing_law" },
      { field: "service_scope", source: "agent_memories", path: "service_scope" },
    ],
  },

  draft_email: {
    required: [
      { field: "recipient_name", source: "pipeline_record", path: "contact_name" },
      { field: "recipient_email", source: "pipeline_record", path: "contact_email" },
    ],
    optional: [],
  },

  book_meeting: {
    required: [
      { field: "lead_email", source: "pipeline_record", path: "contact_email" },
      { field: "available_times", source: "calendar_connection", path: "calendar_connection" },
      { field: "meeting_duration", source: "workflow_settings", path: "defaultMeetingDuration" },
    ],
    optional: [
      { field: "calendly_link", source: "calendar_connection", path: "calendly_event_types" },
      { field: "prospect_timezone", source: "pipeline_record", path: "timezone" },
    ],
  },
};

// ── Task Type Inference ──────────────────────────────────────────────────────

/**
 * Infer the likely task type from the event and its data.
 * Returns null if the event doesn't map to a known task schema.
 */
export function inferTaskType(
  eventType: string,
  eventData: Record<string, unknown>
): string | null {
  // User directives often contain task hints
  const directive = (eventData.directive as string ?? eventData.response as string ?? "").toLowerCase();

  if (directive.includes("invoice") || directive.includes("billing")) {
    return "draft_invoice";
  }
  if (directive.includes("proposal")) {
    return "draft_proposal";
  }
  if (directive.includes("contract") || directive.includes("agreement")) {
    return "draft_contract";
  }

  if (
    directive.includes("meeting") ||
    directive.includes("book") ||
    directive.includes("schedule") ||
    directive.includes("demo") ||
    directive.includes("call")
  ) {
    return "book_meeting";
  }

  // For reply/follow-up events, it's just a regular email
  if (
    eventType === "lead.reply.received" ||
    eventType === "cadence.followup.due" ||
    eventType === "lead.qualified.hot"
  ) {
    return "draft_email";
  }

  // Meeting transcript → could be follow-up email or proposal depending on outcome
  if (eventType === "meeting.transcript.ready") {
    return "draft_email"; // Conservative — just an email follow-up
  }

  return null;
}

// ── Core Check ───────────────────────────────────────────────────────────────

/**
 * Check whether all required data is available for a given task type.
 * Returns missing fields and a completeness score.
 */
export function checkKnowledge(
  taskType: string,
  pipeline: PipelineRecord,
  workflowSettings: SkylerWorkflowSettings,
  agentMemories: AgentMemory[]
): KnowledgeCheckResult {
  const schema = TASK_SCHEMAS[taskType];
  if (!schema) {
    // Unknown task type — can't check, proceed
    return { isComplete: true, missingFields: [], completenessScore: 1, requestDescription: "" };
  }

  const memoryMap = new Map(
    agentMemories
      .filter((m) => m.is_current)
      .map((m) => [m.fact_key, m.fact_value])
  );

  const missingRequired: string[] = [];
  let hasCriticalMissing = false;

  for (const field of schema.required) {
    const value = resolveField(field, pipeline, workflowSettings, memoryMap);
    if (!value) {
      missingRequired.push(field.field);
      if (field.critical) hasCriticalMissing = true;
    }
  }

  const totalRequired = schema.required.length;
  const presentRequired = totalRequired - missingRequired.length;
  const completenessScore = totalRequired > 0 ? presentRequired / totalRequired : 1;

  // Decision logic:
  // - ANY critical field missing → always request_info (even in draft_best_attempt)
  // - Below 80% completeness → request_info OR draft_best_attempt depending on setting
  // - 80-99% → proceed (missing only non-critical fields)
  // - 100% → proceed
  const wouldBlock = !(!hasCriticalMissing && completenessScore >= 0.8);
  const gapMode = workflowSettings.knowledgeGapHandling ?? "ask_first";

  // In "draft_best_attempt" mode: proceed with non-critical gaps, but flag them
  // Critical gaps ALWAYS block regardless of mode
  if (wouldBlock && gapMode === "draft_best_attempt" && !hasCriticalMissing) {
    const humanReadable = missingRequired.map(formatFieldName);
    return {
      isComplete: true, // Allow proceeding
      missingFields: missingRequired,
      completenessScore,
      requestDescription: "",
      draftedWithGaps: true,
      gapWarning: `Drafted with missing information: ${humanReadable.join(", ")}. Please review carefully before sending.`,
    };
  }

  const isComplete = !wouldBlock;

  let requestDescription = "";
  if (!isComplete && missingRequired.length > 0) {
    const humanReadable = missingRequired.map(formatFieldName);
    requestDescription = `I need the following information before I can proceed: ${humanReadable.join(", ")}. Could you provide these details?`;
  }

  return {
    isComplete,
    missingFields: missingRequired,
    completenessScore,
    requestDescription,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveField(
  field: RequiredField,
  pipeline: PipelineRecord,
  workflowSettings: SkylerWorkflowSettings,
  memoryMap: Map<string, unknown>
): unknown {
  switch (field.source) {
    case "pipeline_record": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (pipeline as any)[field.path];
      return val !== undefined && val !== null && val !== "" ? val : null;
    }

    case "workflow_settings": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (workflowSettings as any)[field.path];
      return val !== undefined && val !== null && val !== "" ? val : null;
    }

    case "agent_memories": {
      const val = memoryMap.get(field.path);
      return val !== undefined && val !== null ? val : null;
    }

    case "calendar_connection": {
      // Calendar connections are checked via agent_memories for manual availability
      // or workspace-level calendar_connections table. In the knowledge checker,
      // we treat "user_prefers_manual_availability" memory as a valid substitute.
      const manualPref = memoryMap.get("user_prefers_manual_availability");
      if (manualPref) return manualPref;
      const manualTimes = memoryMap.get("available_times");
      if (manualTimes) return manualTimes;
      // Actual calendar connection check happens at runtime in the booking flow
      // For the knowledge checker, we return null to trigger request_info
      // unless the workspace has a calendar connected (checked below)
      return null;
    }

    default:
      return null;
  }
}

/** Convert snake_case field names to human-readable labels */
function formatFieldName(fieldName: string): string {
  return fieldName.replace(/_/g, " ");
}

/**
 * Get the schema for a task type (for external use, e.g. testing).
 */
export function getTaskSchema(taskType: string): TaskSchema | null {
  return TASK_SCHEMAS[taskType] ?? null;
}

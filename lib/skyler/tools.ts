/**
 * Skyler's tool definitions.
 * Read tools reused from CleverBrain + 8 HubSpot write tools for Sub-Sprint 2.
 */

import { CLEVERBRAIN_TOOLS } from "@/lib/cleverbrain/tools";
import type Anthropic from "@anthropic-ai/sdk";

// ── Read tools (shared with CleverBrain) ─────────────────────────────────────

const SKYLER_READ_TOOL_NAMES = new Set([
  "search_knowledge_base",
  "fetch_recent_messages",
  "search_by_person",
  "search_web",
  "browse_website",
]);

const SKYLER_READ_TOOLS = CLEVERBRAIN_TOOLS.filter((t) =>
  SKYLER_READ_TOOL_NAMES.has(t.name)
);

// ── Write tools (HubSpot via Nango) ──────────────────────────────────────────

const SKYLER_WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_contact",
    description:
      "Create a new contact in HubSpot CRM. Use when the user asks to add a new contact, lead, or person to the CRM.",
    input_schema: {
      type: "object" as const,
      properties: {
        first_name: { type: "string", description: "Contact's first name" },
        last_name: { type: "string", description: "Contact's last name" },
        email: { type: "string", description: "Contact's email address" },
        phone: { type: "string", description: "Contact's phone number" },
        company: { type: "string", description: "Contact's company name" },
        job_title: { type: "string", description: "Contact's job title" },
        notes: { type: "string", description: "Additional notes about the contact" },
      },
      required: ["first_name", "last_name"],
    },
  },
  {
    name: "update_contact",
    description:
      "Update an existing contact in HubSpot CRM. Use when the user wants to change a contact's details.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "HubSpot contact ID to update" },
        first_name: { type: "string", description: "Updated first name" },
        last_name: { type: "string", description: "Updated last name" },
        email: { type: "string", description: "Updated email address" },
        phone: { type: "string", description: "Updated phone number" },
        company: { type: "string", description: "Updated company name" },
        job_title: { type: "string", description: "Updated job title" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "create_company",
    description:
      "Create a new company in HubSpot CRM. Use when the user asks to add a new organisation or company.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Company name" },
        domain: { type: "string", description: "Company website domain (e.g. acme.com)" },
        industry: { type: "string", description: "Company industry" },
        description: { type: "string", description: "Company description" },
        phone: { type: "string", description: "Company phone number" },
        city: { type: "string", description: "Company city" },
        country: { type: "string", description: "Company country" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_company",
    description:
      "Update an existing company in HubSpot CRM. Use when the user wants to change company details.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "HubSpot company ID to update" },
        name: { type: "string", description: "Updated company name" },
        domain: { type: "string", description: "Updated website domain" },
        industry: { type: "string", description: "Updated industry" },
        description: { type: "string", description: "Updated description" },
        phone: { type: "string", description: "Updated phone number" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "create_deal",
    description:
      "Create a new deal in HubSpot CRM. Use when the user wants to add a new deal or opportunity to the pipeline.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_name: { type: "string", description: "Deal name / title" },
        amount: { type: "number", description: "Deal value / amount" },
        stage: { type: "string", description: "Pipeline stage (e.g. 'Qualification', 'Proposal')" },
        close_date: { type: "string", description: "Expected close date (ISO 8601, e.g. 2026-04-15)" },
        pipeline: { type: "string", description: "Pipeline name (uses default if omitted)" },
        contact_id: { type: "string", description: "Associated HubSpot contact ID" },
        company_id: { type: "string", description: "Associated HubSpot company ID" },
        notes: { type: "string", description: "Deal description or notes" },
      },
      required: ["deal_name"],
    },
  },
  {
    name: "update_deal",
    description:
      "Update an existing deal in HubSpot CRM. Use to change deal stage, amount, close date, or other properties.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "HubSpot deal ID to update" },
        deal_name: { type: "string", description: "Updated deal name" },
        amount: { type: "number", description: "Updated deal value" },
        stage: { type: "string", description: "Updated pipeline stage" },
        close_date: { type: "string", description: "Updated close date (ISO 8601)" },
        notes: { type: "string", description: "Updated notes" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in HubSpot CRM. Use for follow-ups, reminders, or action items related to deals or contacts.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: { type: "string", description: "Task subject / title" },
        body: { type: "string", description: "Task description or notes" },
        due_date: { type: "string", description: "Due date (ISO 8601)" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Task priority" },
        contact_id: { type: "string", description: "Associated HubSpot contact ID" },
        deal_id: { type: "string", description: "Associated HubSpot deal ID" },
      },
      required: ["subject"],
    },
  },
  {
    name: "create_note",
    description:
      "Create a note in HubSpot CRM attached to a contact, deal, or company. Use for recording conversation summaries, meeting notes, or important observations.",
    input_schema: {
      type: "object" as const,
      properties: {
        body: { type: "string", description: "Note content (supports plain text)" },
        contact_id: { type: "string", description: "Associated HubSpot contact ID" },
        deal_id: { type: "string", description: "Associated HubSpot deal ID" },
        company_id: { type: "string", description: "Associated HubSpot company ID" },
      },
      required: ["body"],
    },
  },
];

// ── Action management tools (approve/reject pending actions via natural language) ──

const SKYLER_ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "execute_pending_action",
    description:
      "Execute a previously drafted action that is awaiting user approval. Call this when the user approves a pending action with phrases like 'yes', 'go ahead', 'approve', 'do it', 'confirmed', 'looks good', 'send it', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string", description: "The UUID of the pending action to execute" },
      },
      required: ["action_id"],
    },
  },
  {
    name: "reject_pending_action",
    description:
      "Reject/cancel a previously drafted action. Call this when the user rejects a pending action with phrases like 'no', 'cancel', 'reject', 'don't', 'nevermind', 'skip it', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string", description: "The UUID of the pending action to reject" },
      },
      required: ["action_id"],
    },
  },
];

// ── Export combined set ──────────────────────────────────────────────────────

export const SKYLER_WRITE_TOOL_NAMES = new Set(
  SKYLER_WRITE_TOOLS.map((t) => t.name)
);

export const SKYLER_ACTION_TOOL_NAMES = new Set(
  SKYLER_ACTION_TOOLS.map((t) => t.name)
);

export const SKYLER_TOOLS: Anthropic.Tool[] = [
  ...SKYLER_READ_TOOLS,
  ...SKYLER_WRITE_TOOLS,
  ...SKYLER_ACTION_TOOLS,
];

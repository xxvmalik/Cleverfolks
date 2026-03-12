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
        industry: { type: "string", description: "HubSpot industry enum value (e.g. MARKETING_AND_ADVERTISING, INFORMATION_TECHNOLOGY_AND_SERVICES, FINANCIAL_SERVICES, BANKING). Use SCREAMING_SNAKE_CASE. Omit if unsure." },
        description: { type: "string", description: "Company description" },
        city: { type: "string", description: "Company city" },
        country: { type: "string", description: "Company country" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_company",
    description:
      "Update an existing company in HubSpot CRM. Use when the user wants to change company details. Search for the company first to get its HubSpot ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "HubSpot company ID to update (from search results 'HubSpot ID:')" },
        name: { type: "string", description: "Updated company name" },
        domain: { type: "string", description: "Updated website domain" },
        industry: { type: "string", description: "HubSpot industry enum (SCREAMING_SNAKE_CASE). Omit if unsure." },
        description: { type: "string", description: "Updated description" },
        phone: { type: "string", description: "Updated phone number" },
        city: { type: "string", description: "Updated city" },
        country: { type: "string", description: "Updated country" },
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
      "Create a new task in HubSpot CRM. Use for follow-ups, reminders, or action items. IMPORTANT: When creating a task for a specific person, FIRST search for them to get their HubSpot contact ID AND their company's HubSpot ID, then pass both as contact_id and company_id.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: { type: "string", description: "Task subject / title" },
        body: { type: "string", description: "Task description or notes" },
        due_date: { type: "string", description: "Due date (ISO 8601)" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Task priority" },
        contact_id: { type: "string", description: "Associated HubSpot contact ID (from search results 'HubSpot ID:')" },
        company_id: { type: "string", description: "Associated HubSpot company ID (from search results 'HubSpot ID:')" },
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

// ── Lead scoring tools ──────────────────────────────────────────────────────

const SKYLER_LEAD_TOOLS: Anthropic.Tool[] = [
  {
    name: "score_lead",
    description:
      "Score a contact/lead using the BANT framework (Budget, Authority, Need, Timeline). Analyses all synced data (emails, deals, company info) to produce a 0-100 score and classification (hot/nurture/disqualified). Use when the user asks to qualify, score, or assess a lead.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "HubSpot contact ID to score (from search results 'HubSpot ID:')",
        },
        force_rescore: {
          type: "boolean",
          description: "Force rescoring even if already scored. Default false.",
        },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_lead_scores",
    description:
      "Retrieve scored leads for the workspace. Returns lead scores with classification and dimension breakdowns. Use when the user asks about lead pipeline, hot leads, lead scores, or qualification status.",
    input_schema: {
      type: "object" as const,
      properties: {
        classification: {
          type: "string",
          enum: ["hot", "nurture", "disqualified", "all"],
          description: "Filter by classification. Default 'all'.",
        },
        limit: {
          type: "number",
          description: "Max number of leads to return. Default 20.",
        },
      },
      required: [],
    },
  },
];

// ── Sales Closer tools ──────────────────────────────────────────────────────

const SKYLER_SALES_CLOSER_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_sales_pipeline",
    description:
      "View the sales pipeline records. Shows leads being actively worked by Sales Closer with stage, email stats, and conversation state. Use when the user asks about the sales pipeline, outreach progress, or active campaigns.",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: {
          type: "string",
          enum: ["all", "initial_outreach", "follow_up_1", "follow_up_2", "follow_up_3", "negotiation", "demo_booked", "payment_secured", "closed_won", "disqualified", "stalled"],
          description: "Filter by pipeline stage. Default 'all'.",
        },
        limit: { type: "number", description: "Max records to return. Default 20." },
      },
      required: [],
    },
  },
  {
    name: "get_performance_metrics",
    description:
      "Get Skyler's sales performance metrics: emails sent, open rate, reply rate, meetings booked, demos, payments, conversion rate. Use when the user asks 'how am I performing?', 'show me metrics', or 'success rate'.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "move_to_sales_closer",
    description:
      "Manually move a qualified lead into the Sales Closer pipeline for active outreach. Use when the user says 'start outreach to [contact]', 'add [contact] to sales closer', or 'work this lead'. IMPORTANT: Extract ALL context the user provides — website URLs, descriptions of what the business does, any background info. This context dramatically improves research and email quality.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "HubSpot contact ID" },
        contact_email: { type: "string", description: "Contact's email address (required for outreach)" },
        contact_name: { type: "string", description: "Contact's full name" },
        company_name: { type: "string", description: "Contact's company name" },
        website: { type: "string", description: "Company website URL (e.g. 'prominess.com'). Extract from user message if they mention a website." },
        user_context: { type: "string", description: "Any additional context the user provides about the lead — what the business does, their role, relationship, etc. Capture everything that isn't name/email/company." },
      },
      required: ["contact_email"],
    },
  },
  {
    name: "pickup_conversation",
    description:
      "Take over an existing email conversation with a contact. Skyler reads previous emails to understand context before continuing. Use when the user says 'take over my conversation with [contact]' or 'pick up where I left off with [person]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_email: { type: "string", description: "Contact's email address" },
        contact_name: { type: "string", description: "Contact's name (helps find email threads)" },
        contact_id: { type: "string", description: "HubSpot contact ID (optional)" },
        company_name: { type: "string", description: "Company name (optional)" },
      },
      required: ["contact_email"],
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
  {
    name: "draft_correction_email",
    description:
      "Draft a corrected/replacement email for a pipeline lead. Use when the user gives feedback on an already-sent email and wants you to send a follow-up with corrections, or when the user asks you to re-draft/rewrite an email for a specific lead. The system will use the full email engine (sender identity, playbook, thread context, rules) to generate the draft — you just provide the feedback.",
    input_schema: {
      type: "object" as const,
      properties: {
        pipeline_id: { type: "string", description: "Pipeline record ID" },
        user_feedback: { type: "string", description: "What the user wants changed or the instructions for the new draft. Summarise the user's feedback clearly." },
      },
      required: ["pipeline_id", "user_feedback"],
    },
  },
];

// ── Export combined set ──────────────────────────────────────────────────────

export const SKYLER_WRITE_TOOL_NAMES = new Set(
  SKYLER_WRITE_TOOLS.map((t) => t.name)
);

export const SKYLER_LEAD_TOOL_NAMES = new Set(
  SKYLER_LEAD_TOOLS.map((t) => t.name)
);

export const SKYLER_SALES_CLOSER_TOOL_NAMES = new Set(
  SKYLER_SALES_CLOSER_TOOLS.map((t) => t.name)
);

export const SKYLER_ACTION_TOOL_NAMES = new Set(
  SKYLER_ACTION_TOOLS.map((t) => t.name)
);

export const SKYLER_TOOLS: Anthropic.Tool[] = [
  ...SKYLER_READ_TOOLS,
  ...SKYLER_WRITE_TOOLS,
  ...SKYLER_LEAD_TOOLS,
  ...SKYLER_SALES_CLOSER_TOOLS,
  ...SKYLER_ACTION_TOOLS,
];

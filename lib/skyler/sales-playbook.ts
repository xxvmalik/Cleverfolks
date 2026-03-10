/**
 * Sales Playbook Builder for Skyler Sales Closer.
 * Transforms raw workspace memories into a structured sales playbook
 * that the email drafter and company research can use for targeted outreach.
 * Cached per workspace with a configurable refresh interval.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import { SALES_CLOSER_DEFAULTS } from "@/lib/email/email-sender";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";

export type SalesPlaybook = {
  company_name: string;
  elevator_pitch: string;
  services: Array<{
    name: string;
    description: string;
    key_benefits: string[];
    ideal_customer: string;
  }>;
  pricing_info: string;
  differentiators: string[];
  target_industries: string[];
  target_company_sizes: string[];
  pain_points_we_solve: string[];
  case_studies: string[];
  objection_handlers: Array<{
    objection: string;
    response: string;
  }>;
  tone_guidelines: string;
  built_at: string;
};

const PLAYBOOK_PROMPT = `You are building a structured sales playbook from a company's workspace memories.
These memories contain everything the business has taught the system about who they are, what they sell, their pricing, customers, and processes.

Extract and organise this information into a structured JSON sales playbook.

CRITICAL FILTERING RULES:
- ONLY include information that is EXPLICITLY described as something the business SELLS or OFFERS to customers.
- IGNORE any deal names, deal amounts, pipeline stages, or contact records — those are CRM sales pipeline data, NOT product information.
- If you see entries like "TechStartup Lagos - API Reseller Access: ₦1,200,000" or "Monthly Bulk Plan: ₦150,000" — those are DEALS (prospects being worked on), NOT service offerings. Do NOT include them as services or pricing.
- Deal names often follow the pattern "[Company Name] - [Description]: [Currency][Amount]" — these are ALWAYS deals, never products.
- Real service/product descriptions talk about what the service DOES, its features, and benefits. Deals talk about who is buying and how much.
- If a field has no relevant data, use an empty string or empty array.
- Do NOT invent services, pricing, or claims not explicitly stated.
- The playbook will be used by an AI sales agent to write personalised outreach emails, so accuracy is critical.

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences. Do NOT include \`\`\`json or \`\`\` markers.

{
  "company_name": "The company's name",
  "elevator_pitch": "2-3 sentence summary of what the company does and who it serves",
  "services": [
    {
      "name": "Service name",
      "description": "What this service does",
      "key_benefits": ["benefit 1", "benefit 2"],
      "ideal_customer": "Who this service is best for"
    }
  ],
  "pricing_info": "Any pricing, plans, or rate information mentioned",
  "differentiators": ["What makes this company different from competitors"],
  "target_industries": ["Industries they serve"],
  "target_company_sizes": ["Company sizes they target, e.g. 'SMBs', '1-50 employees'"],
  "pain_points_we_solve": ["Specific problems their services address"],
  "case_studies": ["Any mentioned results, testimonials, or success stories"],
  "objection_handlers": [
    {
      "objection": "Common objection",
      "response": "How to handle it"
    }
  ],
  "tone_guidelines": "Any brand voice, tone, or communication style preferences"
}

Workspace memories:
`;

/**
 * Build a structured sales playbook from workspace memories using Claude Sonnet.
 * Caches the result in workspace_memories with type "sales_playbook".
 */
export async function buildSalesPlaybook(
  db: SupabaseClient,
  workspaceId: string,
  memories: string[]
): Promise<SalesPlaybook> {
  // Check for cached playbook (less than 30 days old)
  const cached = await getCachedPlaybook(db, workspaceId);
  if (cached) return cached;

  if (!memories || memories.length === 0) {
    console.warn("[sales-playbook] No workspace memories — returning empty playbook");
    return emptyPlaybook();
  }

  // Filter out deal/pipeline data before building playbook
  const filteredMemories = filterDealMemories(memories);
  if (filteredMemories.length === 0) {
    console.warn("[sales-playbook] All memories were deal data — returning empty playbook");
    return emptyPlaybook();
  }
  console.log(`[sales-playbook] Using ${filteredMemories.length}/${memories.length} memories (${memories.length - filteredMemories.length} deal records filtered)`);

  const memoriesText = filteredMemories
    .map((m, i) => `[${i + 1}] ${m}`)
    .join("\n")
    .slice(0, 10000); // Cap for cost control

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: PLAYBOOK_PROMPT + memoriesText }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const playbook = parseAIJson<SalesPlaybook>(text);
    playbook.built_at = new Date().toISOString();

    // Cache the playbook
    await cachePlaybook(db, workspaceId, playbook);

    console.log(`[sales-playbook] Built playbook for "${playbook.company_name}" with ${playbook.services.length} services`);
    return playbook;
  } catch (err) {
    console.error("[sales-playbook] Build failed:", err instanceof Error ? err.message : String(err));
    return emptyPlaybook();
  }
}

/**
 * Get a cached playbook if it exists and is fresh enough.
 */
async function getCachedPlaybook(
  db: SupabaseClient,
  workspaceId: string
): Promise<SalesPlaybook | null> {
  const { data } = await db
    .from("workspace_memories")
    .select("metadata, created_at")
    .eq("workspace_id", workspaceId)
    .eq("type", "sales_playbook")
    .is("superseded_by", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.metadata) return null;

  const ageMs = Date.now() - new Date(data.created_at as string).getTime();
  const cacheDays = SALES_CLOSER_DEFAULTS.voice_refresh_days; // 30 days
  if (ageMs > cacheDays * 86400000) {
    console.log("[sales-playbook] Cached playbook is stale, will rebuild");
    return null;
  }

  console.log(`[sales-playbook] Using cached playbook (${Math.round(ageMs / 86400000)}d old)`);
  return data.metadata as unknown as SalesPlaybook;
}

/**
 * Cache the playbook in workspace_memories.
 */
async function cachePlaybook(
  db: SupabaseClient,
  workspaceId: string,
  playbook: SalesPlaybook
): Promise<void> {
  // Supersede any existing playbook memories
  await db
    .from("workspace_memories")
    .update({ superseded_by: "rebuilt" })
    .eq("workspace_id", workspaceId)
    .eq("type", "sales_playbook")
    .is("superseded_by", null);

  // Insert new playbook memory
  await db.from("workspace_memories").insert({
    workspace_id: workspaceId,
    scope: "workspace",
    type: "sales_playbook",
    content: `Sales playbook for ${playbook.company_name}: ${playbook.elevator_pitch}`,
    confidence: "high",
    metadata: playbook,
    source_conversation_id: null,
    created_by: null,
  });
}

/**
 * Format a playbook into a concise text block for use in prompts.
 */
export function formatPlaybookForPrompt(playbook: SalesPlaybook): string {
  if (!playbook.company_name && playbook.services.length === 0) {
    return "No structured business context available.";
  }

  const sections: string[] = [];

  if (playbook.company_name) {
    sections.push(`Company: ${playbook.company_name}`);
  }
  if (playbook.elevator_pitch) {
    sections.push(`About: ${playbook.elevator_pitch}`);
  }

  if (playbook.services.length > 0) {
    sections.push("\nSERVICES WE SELL:");
    for (const svc of playbook.services) {
      sections.push(`• ${svc.name}: ${svc.description}`);
      if (svc.key_benefits.length > 0) {
        sections.push(`  Benefits: ${svc.key_benefits.join(", ")}`);
      }
      if (svc.ideal_customer) {
        sections.push(`  Best for: ${svc.ideal_customer}`);
      }
    }
  }

  if (playbook.pricing_info) {
    sections.push(`\nPRICING: ${playbook.pricing_info}`);
  }

  if (playbook.differentiators.length > 0) {
    sections.push(`\nWHY US: ${playbook.differentiators.join("; ")}`);
  }

  if (playbook.pain_points_we_solve.length > 0) {
    sections.push(`\nPROBLEMS WE SOLVE: ${playbook.pain_points_we_solve.join("; ")}`);
  }

  if (playbook.case_studies.length > 0) {
    sections.push(`\nSOCIAL PROOF: ${playbook.case_studies.join("; ")}`);
  }

  if (playbook.objection_handlers.length > 0) {
    sections.push("\nOBJECTION HANDLING:");
    for (const oh of playbook.objection_handlers) {
      sections.push(`• "${oh.objection}" → ${oh.response}`);
    }
  }

  if (playbook.tone_guidelines) {
    sections.push(`\nTONE: ${playbook.tone_guidelines}`);
  }

  return sections.join("\n");
}

function emptyPlaybook(): SalesPlaybook {
  return {
    company_name: "",
    elevator_pitch: "",
    services: [],
    pricing_info: "",
    differentiators: [],
    target_industries: [],
    target_company_sizes: [],
    pain_points_we_solve: [],
    case_studies: [],
    objection_handlers: [],
    tone_guidelines: "",
    built_at: new Date().toISOString(),
  };
}

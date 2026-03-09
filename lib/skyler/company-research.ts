/**
 * Company research for Skyler Sales Closer.
 * Uses Tavily web search + GPT-4o-mini to produce structured company intelligence
 * before drafting any outreach email.
 */

import { classifyWithGPT4oMini } from "@/lib/openai-client";
import { searchWeb } from "@/lib/web-search";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SALES_CLOSER_DEFAULTS } from "@/lib/email/email-sender";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import type { SalesPlaybook } from "@/lib/skyler/sales-playbook";
import { formatPlaybookForPrompt } from "@/lib/skyler/sales-playbook";

export type CompanyResearch = {
  summary: string;
  industry: string;
  estimated_size: string;
  recent_news: string[];
  pain_points: string[];
  decision_makers: string[];
  talking_points: string[];
  service_alignment_points: string[];
  website_insights: string;
  researched_at: string;
};

function buildResearchPrompt(businessContext: string, playbookText?: string): string {
  const ourContext = playbookText || businessContext || "No business context provided yet.";
  return `You are analysing web search results about a PROSPECT company to prepare for a sales outreach email.

IMPORTANT CONTEXT — Who we are (the company doing the selling):
${ourContext}

Produce a structured JSON response with these fields:
- summary: 2-3 sentence overview of the PROSPECT (what THEY do, where they're based, rough size)
- industry: the PROSPECT's primary industry
- estimated_size: one of "1-10", "11-50", "51-200", "201-1000", "1000+"
- recent_news: array of up to 3 relevant recent news items about the PROSPECT (one sentence each)
- pain_points: array of 2-4 potential business problems the PROSPECT might have that OUR services could solve
- decision_makers: array of key people at the PROSPECT mentioned (name and role)
- talking_points: array of 3-5 specific hooks for personalised outreach to the PROSPECT
- service_alignment_points: array of 2-3 specific ways OUR services could help THIS PROSPECT (connect our actual services to their actual needs). If no business context is available, leave empty.
- website_insights: one paragraph about the PROSPECT's online presence

CRITICAL: The "pain_points", "talking_points", and "service_alignment_points" must be about problems the PROSPECT has that WE can solve. Do NOT describe what the PROSPECT sells as if we are selling it.

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences. Do NOT include \`\`\`json or \`\`\` markers.
If information is not available for a field, use an empty string or empty array.

PROSPECT Company: {company_name}
PROSPECT Contact: {contact_name} ({contact_email})

Web search results:
`;
}

/**
 * Research a company using Tavily web search and GPT-4o-mini analysis.
 * Caches results in the pipeline record's company_research field.
 */
export async function researchCompany(params: {
  companyName: string;
  companyWebsite?: string;
  contactName?: string;
  contactEmail?: string;
  workspaceId: string;
  pipelineId?: string;
  db?: SupabaseClient;
  businessContext?: string;
  salesPlaybook?: SalesPlaybook | null;
}): Promise<CompanyResearch> {
  const { companyName, companyWebsite, contactName, contactEmail, workspaceId, pipelineId, db, businessContext, salesPlaybook } = params;

  // Check for cached research (less than 7 days old)
  if (db && pipelineId) {
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("company_research, research_updated_at")
      .eq("id", pipelineId)
      .single();

    if (pipeline?.company_research && pipeline.research_updated_at) {
      const ageMs = Date.now() - new Date(pipeline.research_updated_at).getTime();
      const cacheDays = SALES_CLOSER_DEFAULTS.research_cache_days;
      if (ageMs < cacheDays * 86400000) {
        console.log(`[company-research] Using cached research for ${companyName} (${Math.round(ageMs / 86400000)}d old)`);
        return pipeline.company_research as CompanyResearch;
      }
    }
  }

  // Run web searches in parallel
  const queries = [
    `${companyName} company overview`,
    `${companyName} recent news ${new Date().getFullYear()}`,
  ];
  if (companyWebsite) {
    queries.push(`site:${companyWebsite} about`);
  }
  if (contactName) {
    queries.push(`${contactName} ${companyName}`);
  }

  const searchResults = await Promise.all(
    queries.map((q) => searchWeb(q, 3))
  );

  const allResults = searchResults.flat();
  const combinedText = allResults
    .map((r) => `[${r.title}] (${r.url})\n${r.content}`)
    .join("\n\n")
    .slice(0, 6000); // Cap input for cost control

  if (!combinedText.trim()) {
    console.warn(`[company-research] No web results found for ${companyName}`);
    const fallback: CompanyResearch = {
      summary: `Limited information available for ${companyName}.`,
      industry: "Unknown",
      estimated_size: "Unknown",
      recent_news: [],
      pain_points: [],
      decision_makers: [],
      talking_points: [`Personalise based on ${contactName ?? contactEmail ?? "the contact"}'s role`],
      service_alignment_points: [],
      website_insights: "No website data available.",
      researched_at: new Date().toISOString(),
    };
    return fallback;
  }

  // Analyse with GPT-4o-mini — prefer playbook over raw context
  const playbookText = salesPlaybook ? formatPlaybookForPrompt(salesPlaybook) : undefined;
  const systemPrompt = buildResearchPrompt(businessContext ?? "", playbookText)
    .replace("{company_name}", companyName)
    .replace("{contact_name}", contactName ?? "Unknown")
    .replace("{contact_email}", contactEmail ?? "Unknown");

  try {
    const text = await classifyWithGPT4oMini({
      systemPrompt,
      userContent: combinedText,
      maxTokens: 2000,
    });

    const parsed = parseAIJson<CompanyResearch>(text);
    parsed.researched_at = new Date().toISOString();
    if (!parsed.service_alignment_points) parsed.service_alignment_points = [];

    // Cache in pipeline record
    if (db && pipelineId) {
      await db
        .from("skyler_sales_pipeline")
        .update({
          company_research: parsed,
          research_updated_at: parsed.researched_at,
          updated_at: parsed.researched_at,
        })
        .eq("id", pipelineId);
    }

    console.log(`[company-research] Researched ${companyName} (GPT-4o-mini): ${parsed.summary.slice(0, 100)}`);
    return parsed;
  } catch (err) {
    console.error("[company-research] Analysis failed:", err instanceof Error ? err.message : String(err));
    return {
      summary: `Research completed for ${companyName} but analysis failed.`,
      industry: "Unknown",
      estimated_size: "Unknown",
      recent_news: [],
      pain_points: [],
      decision_makers: [],
      talking_points: [],
      service_alignment_points: [],
      website_insights: allResults.map((r) => r.content).join(" ").slice(0, 500),
      researched_at: new Date().toISOString(),
    };
  }
}

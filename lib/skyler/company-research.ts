/**
 * Company research for Skyler Sales Closer.
 * Uses Tavily web search + Claude Haiku to produce structured company intelligence
 * before drafting any outreach email.
 */

import Anthropic from "@anthropic-ai/sdk";
import { searchWeb } from "@/lib/web-search";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SALES_CLOSER_DEFAULTS } from "@/lib/email/resend-client";

export type CompanyResearch = {
  summary: string;
  industry: string;
  estimated_size: string;
  recent_news: string[];
  pain_points: string[];
  decision_makers: string[];
  talking_points: string[];
  website_insights: string;
  researched_at: string;
};

const RESEARCH_PROMPT = `You are analysing web search results about a company to prepare for a sales outreach email.

Produce a structured JSON response with these fields:
- summary: 2-3 sentence company overview (what they do, where they're based, rough size)
- industry: the company's primary industry
- estimated_size: one of "1-10", "11-50", "51-200", "201-1000", "1000+"
- recent_news: array of up to 3 relevant recent news items (one sentence each)
- pain_points: array of 2-4 potential business problems we could help solve
- decision_makers: array of key people mentioned (name and role)
- talking_points: array of 3-5 specific hooks for personalised outreach
- website_insights: one paragraph about what we learned from their online presence

Respond with ONLY valid JSON, no other text.
If information is not available for a field, use an empty string or empty array.

Company: {company_name}
Contact: {contact_name} ({contact_email})

Web search results:
`;

/**
 * Research a company using Tavily web search and Claude Haiku analysis.
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
}): Promise<CompanyResearch> {
  const { companyName, companyWebsite, contactName, contactEmail, workspaceId, pipelineId, db } = params;

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
      website_insights: "No website data available.",
      researched_at: new Date().toISOString(),
    };
    return fallback;
  }

  // Analyse with Haiku
  const prompt = RESEARCH_PROMPT
    .replace("{company_name}", companyName)
    .replace("{contact_name}", contactName ?? "Unknown")
    .replace("{contact_email}", contactEmail ?? "Unknown")
    + combinedText;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = JSON.parse(text) as CompanyResearch;
    parsed.researched_at = new Date().toISOString();

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

    console.log(`[company-research] Researched ${companyName}: ${parsed.summary.slice(0, 100)}`);
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
      website_insights: allResults.map((r) => r.content).join(" ").slice(0, 500),
      researched_at: new Date().toISOString(),
    };
  }
}

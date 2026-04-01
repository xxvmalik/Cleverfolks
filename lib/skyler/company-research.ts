/**
 * Company research for Skyler Sales Closer.
 * Uses Tavily web search + website extraction + GPT-4o-mini to produce
 * structured company intelligence before drafting any outreach email.
 *
 * Research priority:
 * 1. User-provided context (highest trust — the user told us directly)
 * 2. Company website (most authoritative automated source)
 * 3. Web search results (supplementary)
 */

import { classifyWithGPT4oMini } from "@/lib/openai-client";
import { searchWeb, extractWebsite } from "@/lib/web-search";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SALES_CLOSER_DEFAULTS } from "@/lib/email/email-sender";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import type { SalesPlaybook } from "@/lib/skyler/sales-playbook";
import { formatPlaybookForPrompt } from "@/lib/skyler/sales-playbook";

export type CompanyResearch = {
  summary: string;
  industry: string;
  estimated_size: string;
  trigger_event: string;
  recent_news: string[];
  pain_points: string[];
  decision_makers: string[];
  talking_points: string[];
  service_alignment_points: string[];
  website_insights: string;
  researched_at: string;
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
};

function buildResearchPrompt(params: {
  businessContext: string;
  playbookText?: string;
  userContext?: string;
  websiteContent?: string;
}): string {
  const ourContext = params.playbookText || params.businessContext || "No business context provided yet.";

  const userContextBlock = params.userContext
    ? `\nUSER-PROVIDED CONTEXT (HIGHEST TRUST — the user told us this directly):\n${params.userContext}\n\nThis context is authoritative. Trust it completely over web search results.`
    : "";

  const websiteBlock = params.websiteContent
    ? `\nCOMPANY WEBSITE CONTENT (HIGH TRUST — extracted from their actual website):\n${params.websiteContent.slice(0, 4000)}\n\nThe website is the most authoritative automated source for what the business does. Trust it over web search snippets.`
    : "";

  return `Research this PROSPECT company for sales outreach. You MUST determine what this business actually does.

CRITICAL RULES:
- If user-provided context exists, trust it COMPLETELY — the user knows this lead
- If a website is provided, the website content is the MOST authoritative automated source
- NEVER assume what a business does based on the company name alone
- "Digital" in a company name does NOT mean digital marketing
- "Solutions" does NOT mean consulting
- If the website and web search give conflicting info, trust the website
- If you genuinely cannot determine what the business does, set confidence to "low"
${userContextBlock}${websiteBlock}

Find in this EXACT priority order:

1. WHAT THEY ACTUALLY DO (from user context / website / search):
   - Their core business, products, or services
   - This is the MOST important field — get it right

2. TRIGGER EVENTS (5x higher conversion when referenced in outreach):
   - Recent funding rounds, new hires, product launches, expansions
   - Mergers, acquisitions, partnerships
   If you find a trigger event, it becomes the PRIMARY talking point.

3. COMPANY OVERVIEW:
   - Size and growth stage
   - Industry

4. PAIN POINTS:
   - Specific challenges they might face that OUR services could help with
   - Industry-wide challenges affecting companies like them

5. KEY PEOPLE:
   - Decision makers if findable
   - The contact we're reaching out to — their role and influence level

WHO WE ARE (the company doing the selling):
${ourContext}

RULES:
- Do NOT make up information. If you can't find something, use empty string or empty array.
- Do NOT confuse our company with theirs.
- The "pain_points", "talking_points", and "service_alignment_points" must be about problems the PROSPECT has that WE can solve.

CONFIDENCE SCORING:
- "high": You have strong evidence of what the business does (website content, user context, or multiple corroborating search results)
- "medium": You have some evidence but not fully certain (only search snippets, partial info)
- "low": You cannot confidently determine what the business does (no website, no user context, minimal/conflicting search results, or you're guessing based on the name)

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences.

{
  "summary": "2-3 sentence overview of the PROSPECT",
  "industry": "their primary industry",
  "estimated_size": "one of: 1-10, 11-50, 51-200, 201-1000, 1000+",
  "trigger_event": "the most recent/relevant trigger event found, or empty string if none",
  "recent_news": ["up to 3 relevant news items, one sentence each"],
  "pain_points": ["2-4 business problems they might have that OUR services solve"],
  "decision_makers": ["key people mentioned (name and role)"],
  "talking_points": ["3-5 specific hooks for outreach — lead with trigger event if found"],
  "service_alignment_points": ["2-3 specific ways OUR services help THIS prospect"],
  "website_insights": "one paragraph about their online presence",
  "confidence": "high or medium or low",
  "confidence_reason": "one sentence explaining why this confidence level"
}

PROSPECT Company: {company_name}
PROSPECT Contact: {contact_name} ({contact_email})

Web search results:
`;
}

/**
 * Normalise a website URL — add https:// if missing.
 */
function normaliseUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Research a company using website extraction + Tavily web search + GPT-4o-mini analysis.
 * Caches results in the pipeline record's company_research field.
 */
export async function researchCompany(params: {
  companyName: string;
  companyWebsite?: string;
  contactName?: string;
  contactEmail?: string;
  userContext?: string;
  workspaceId: string;
  pipelineId?: string;
  db?: SupabaseClient;
  businessContext?: string;
  salesPlaybook?: SalesPlaybook | null;
}): Promise<CompanyResearch> {
  const { companyName, companyWebsite, contactName, contactEmail, userContext, workspaceId, pipelineId, db, businessContext, salesPlaybook } = params;

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

  // Priority 1: Browse the company website if provided
  let websiteContent: string | null = null;
  if (companyWebsite) {
    const url = normaliseUrl(companyWebsite);
    console.log(`[company-research] Browsing website: ${url}`);
    websiteContent = await extractWebsite(url);
    if (websiteContent) {
      console.log(`[company-research] Extracted ${websiteContent.length} chars from ${url}`);
    } else {
      console.warn(`[company-research] Failed to extract content from ${url}`);
    }
  }

  // Priority 2: Run web searches — but SKIP if user provided context.
  // When the user tells us what a company does, web results for similarly-named
  // companies can mislead the AI into ignoring the user's authoritative context.
  let allResults: Awaited<ReturnType<typeof searchWeb>> = [];
  let combinedText = "";

  if (!userContext) {
    const queries = [
      `${companyName} company overview`,
      `${companyName} recent news ${new Date().getFullYear()}`,
    ];
    if (companyWebsite && !websiteContent) {
      queries.push(`site:${companyWebsite} about`);
    }
    if (contactName) {
      queries.push(`${contactName} ${companyName}`);
    }

    const searchResults = await Promise.all(
      queries.map((q) => searchWeb(q, 3))
    );

    allResults = searchResults.flat();
    combinedText = allResults
      .map((r) => `[${r.title}] (${r.url})\n${r.content}`)
      .join("\n\n")
      .slice(0, 6000);
  } else {
    console.log(`[company-research] Skipping web search — user provided context for ${companyName}`);
  }

  // If we have no data at all, return a low-confidence fallback
  if (!combinedText.trim() && !websiteContent && !userContext) {
    console.warn(`[company-research] No data found for ${companyName}`);
    const fallback: CompanyResearch = {
      summary: `Limited information available for ${companyName}.`,
      industry: "Unknown",
      estimated_size: "Unknown",
      trigger_event: "",
      recent_news: [],
      pain_points: [],
      decision_makers: [],
      talking_points: [`Personalise based on ${contactName ?? contactEmail ?? "the contact"}'s role`],
      service_alignment_points: [],
      website_insights: "No website data available.",
      researched_at: new Date().toISOString(),
      confidence: "low",
      confidence_reason: "No website, user context, or web search results found for this company.",
    };
    return fallback;
  }

  // Analyse with GPT-4o-mini — include website content and user context
  const playbookText = salesPlaybook ? formatPlaybookForPrompt(salesPlaybook) : undefined;
  const systemPrompt = buildResearchPrompt({
    businessContext: businessContext ?? "",
    playbookText,
    userContext: userContext ?? undefined,
    websiteContent: websiteContent ?? undefined,
  })
    .replace("{company_name}", companyName)
    .replace("{contact_name}", contactName ?? "Unknown")
    .replace("{contact_email}", contactEmail ?? "Unknown");

  try {
    const text = await classifyWithGPT4oMini({
      systemPrompt,
      userContent: combinedText || "(No web search results — rely on website content and user context above)",
      maxTokens: 2000,
    });

    const parsed = parseAIJson<CompanyResearch>(text);
    parsed.researched_at = new Date().toISOString();
    if (!parsed.service_alignment_points) parsed.service_alignment_points = [];
    if (!parsed.trigger_event) parsed.trigger_event = "";
    if (!parsed.confidence) parsed.confidence = "medium";
    if (!parsed.confidence_reason) parsed.confidence_reason = "";

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

    console.log(`[company-research] Researched ${companyName} (confidence: ${parsed.confidence}): ${parsed.summary.slice(0, 100)}`);
    return parsed;
  } catch (err) {
    console.error("[company-research] Analysis failed:", err instanceof Error ? err.message : String(err));

    // If the user provided context, we have enough to proceed — don't block on AI failure.
    // The user explicitly told us about this lead, so trust that and move forward.
    if (userContext) {
      console.log(`[company-research] AI failed but userContext available — using user context as medium-confidence fallback`);
      const fallback: CompanyResearch = {
        summary: `${companyName} — based on user-provided context: ${userContext.slice(0, 200)}`,
        industry: "See user context",
        estimated_size: "Unknown",
        trigger_event: "",
        recent_news: [],
        pain_points: [],
        decision_makers: contactName ? [`${contactName}`] : [],
        talking_points: [`Based on user intel: ${userContext.slice(0, 150)}`],
        service_alignment_points: [],
        website_insights: websiteContent?.slice(0, 500) ?? allResults.map((r) => r.content).join(" ").slice(0, 500),
        researched_at: new Date().toISOString(),
        confidence: "medium",
        confidence_reason: "AI analysis unavailable but user provided direct context about this lead.",
      };

      // Cache the fallback so we don't retry repeatedly
      if (db && pipelineId) {
        await db
          .from("skyler_sales_pipeline")
          .update({
            company_research: fallback,
            research_updated_at: fallback.researched_at,
            updated_at: fallback.researched_at,
          })
          .eq("id", pipelineId);
      }

      return fallback;
    }

    return {
      summary: `Research completed for ${companyName} but analysis failed.`,
      industry: "Unknown",
      estimated_size: "Unknown",
      trigger_event: "",
      recent_news: [],
      pain_points: [],
      decision_makers: [],
      talking_points: [],
      service_alignment_points: [],
      website_insights: allResults.map((r) => r.content).join(" ").slice(0, 500),
      researched_at: new Date().toISOString(),
      confidence: "low",
      confidence_reason: "Research analysis failed — could not parse results.",
    };
  }
}

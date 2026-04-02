/**
 * Company research for Skyler Sales Closer.
 *
 * Research priority:
 * 1. User-provided context → BUILD DIRECTLY, no AI call, no web search
 * 2. Company website (most authoritative automated source)
 * 3. Web search results (supplementary) — with company name verification
 *
 * When the user tells us what a company does, that IS the research.
 * Web search is only used when we have zero user context.
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

// ── Company name verification ──────────────────────────────────────────────

/**
 * Check if a search result title/content refers to the same company we searched for.
 * Uses normalized substrings — "Prominess" should NOT match "Prominence Advisors".
 */
function companyNameMatches(companyName: string, resultTitle: string, resultContent: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalize(companyName);
  if (target.length < 3) return true; // Too short to verify

  const titleNorm = normalize(resultTitle);
  const contentNorm = normalize(resultContent);

  // Exact substring match in title or first 500 chars of content
  if (titleNorm.includes(target) || contentNorm.slice(0, 500).includes(target)) return true;

  // Check if the company name words appear in order (for multi-word names)
  const words = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 1) {
    const allInTitle = words.every((w) => titleNorm.includes(normalize(w)));
    if (allInTitle) return true;
  }

  return false;
}

// ── Research prompt (only used when NO user context) ───────────────────────

function buildResearchPrompt(params: {
  businessContext: string;
  playbookText?: string;
  websiteContent?: string;
}): string {
  const ourContext = params.playbookText || params.businessContext || "No business context provided yet.";

  const websiteBlock = params.websiteContent
    ? `\nCOMPANY WEBSITE CONTENT (HIGH TRUST — extracted from their actual website):\n${params.websiteContent.slice(0, 4000)}\n\nThe website is the most authoritative automated source for what the business does. Trust it over web search snippets.`
    : "";

  return `Research this PROSPECT company for sales outreach. You MUST determine what this business actually does.

CRITICAL RULES:
- NEVER assume what a business does based on the company name alone
- "Digital" in a company name does NOT mean digital marketing
- "Solutions" does NOT mean consulting
- If the website and web search give conflicting info, trust the website
- If you genuinely cannot determine what the business does, set confidence to "low"
- IMPORTANT: Only use search results that are clearly about THIS specific company. If results seem to be about a different company with a similar name, IGNORE them and set confidence to "low".
${websiteBlock}

Find in this EXACT priority order:

1. WHAT THEY ACTUALLY DO (from website / search):
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
- "high": You have strong evidence of what the business does (website content or multiple corroborating search results)
- "medium": You have some evidence but not fully certain (only search snippets, partial info)
- "low": You cannot confidently determine what the business does (no website, minimal/conflicting search results, or you're guessing based on the name)

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

// ── Fix 1: Build research directly from user context (no AI, no web search) ─

/**
 * When the user provides context about a lead, build the CompanyResearch
 * struct directly. No AI call, no web search, no chance of wrong company.
 */
function buildResearchFromUserContext(params: {
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  userContext: string;
  websiteContent?: string;
}): CompanyResearch {
  const { companyName, contactName, userContext, websiteContent } = params;

  console.log(`[company-research] Building research directly from user context for ${companyName}`);

  return {
    summary: `${companyName}: ${userContext}`,
    industry: "Per user context",
    estimated_size: "Unknown",
    trigger_event: "",
    recent_news: [],
    pain_points: [],
    decision_makers: contactName ? [contactName] : [],
    talking_points: [userContext],
    service_alignment_points: [],
    website_insights: websiteContent?.slice(0, 500) ?? "",
    researched_at: new Date().toISOString(),
    confidence: "high",
    confidence_reason: "Built from user-provided context — the user told us directly what this company does.",
  };
}

/**
 * Research a company using website extraction + Tavily web search + GPT-4o-mini analysis.
 * Caches results in the pipeline record's company_research field.
 *
 * IMPORTANT: When userContext exists, skips ALL external lookups and AI calls.
 * The user's word is the authoritative source — no web search can override it.
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

  // ── FIX 1: User context = skip everything, build directly ──────────────
  // When the user tells us what a company does, that IS the research.
  // No web search (wrong company risk), no AI call (misinterpretation risk).
  if (userContext) {
    // Still try to grab website content if provided (it's their actual site)
    let websiteContent: string | null = null;
    if (companyWebsite) {
      const url = normaliseUrl(companyWebsite);
      try {
        websiteContent = await extractWebsite(url);
      } catch { /* ignore website extraction failure */ }
    }

    const research = buildResearchFromUserContext({
      companyName,
      contactName,
      contactEmail,
      userContext,
      websiteContent: websiteContent ?? undefined,
    });

    // Cache it
    if (db && pipelineId) {
      await db
        .from("skyler_sales_pipeline")
        .update({
          company_research: research,
          research_updated_at: research.researched_at,
          updated_at: research.researched_at,
        })
        .eq("id", pipelineId);
    }

    console.log(`[company-research] ✓ Built from user context: "${userContext.slice(0, 80)}"`);
    return research;
  }

  // ── No user context — use website + web search ─────────────────────────

  // Browse the company website if provided
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

  // Run web searches
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

  let allResults = searchResults.flat();

  // ── FIX 2: Company name verification ───────────────────────────────────
  // Discard search results that aren't actually about this company.
  // This prevents "Prominess" from matching "Prominence Advisors".
  const verifiedResults = allResults.filter((r) =>
    companyNameMatches(companyName, r.title, r.content)
  );

  if (verifiedResults.length < allResults.length) {
    const discarded = allResults.length - verifiedResults.length;
    console.log(`[company-research] Name verification: discarded ${discarded}/${allResults.length} results (company name mismatch for "${companyName}")`);
    allResults = verifiedResults;
  }

  const combinedText = allResults
    .map((r) => `[${r.title}] (${r.url})\n${r.content}`)
    .join("\n\n")
    .slice(0, 6000);

  // If we have no data at all, return a low-confidence fallback
  if (!combinedText.trim() && !websiteContent) {
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
      confidence_reason: "No website or verified web search results found for this company.",
    };
    return fallback;
  }

  // Analyse with GPT-4o-mini (no user context in this path)
  const playbookText = salesPlaybook ? formatPlaybookForPrompt(salesPlaybook) : undefined;
  const systemPrompt = buildResearchPrompt({
    businessContext: businessContext ?? "",
    playbookText,
    websiteContent: websiteContent ?? undefined,
  })
    .replace("{company_name}", companyName)
    .replace("{contact_name}", contactName ?? "Unknown")
    .replace("{contact_email}", contactEmail ?? "Unknown");

  try {
    const text = await classifyWithGPT4oMini({
      systemPrompt,
      userContent: combinedText || "(No web search results — rely on website content above)",
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

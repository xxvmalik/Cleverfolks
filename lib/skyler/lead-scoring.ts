/**
 * Lead Scoring Engine -- deterministic BANT scoring using data from document_chunks.
 * No AI calls for scoring itself -- reasoning text is assembled programmatically.
 * Dimensions are read from workspace settings (JSONB), defaulting to BANT.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Default scoring config ──────────────────────────────────────────────────

export const DEFAULT_SCORING_DIMENSIONS = [
  { key: "budget", label: "Budget", weight: 25, description: "Can they afford it? Look at company size, funding, industry, and deal value." },
  { key: "authority", label: "Authority", weight: 25, description: "Are we talking to the decision maker? Check job title and company size." },
  { key: "need", label: "Need", weight: 25, description: "Do they have the problem we solve? Look at email content, interaction volume, and engagement recency." },
  { key: "timeline", label: "Timeline", weight: 25, description: "Are they buying now or exploring? Check close dates and urgency language." },
];

export const DEFAULT_SCORING_THRESHOLDS = {
  hot: 70,
  nurture: 40,
  disqualified_below: 40,
};

export type ScoringDimension = {
  key: string;
  label: string;
  weight: number;
  description: string;
};

export type DimensionScore = {
  score: number;
  reasoning: string;
};

export type LeadScoreResult = {
  contact_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  company_id: string;
  dimension_scores: Record<string, DimensionScore>;
  total_score: number;
  classification: "hot" | "nurture" | "disqualified";
  is_referral: boolean;
  referrer_name: string | null;
  referrer_company: string | null;
  scoring_reasoning: string;
};

// ── Authority title tiers ───────────────────────────────────────────────────

const TITLE_TIERS: Array<{ patterns: RegExp[]; pct: number }> = [
  { patterns: [/\b(ceo|cto|cfo|coo|cmo|founder|owner|president|director|vp|vice president|head of|chief)\b/i], pct: 0.85 },
  { patterns: [/\b(manager|lead|senior|principal)\b/i], pct: 0.5 },
  { patterns: [/\b(coordinator|specialist|analyst|associate|assistant|intern|executive)\b/i], pct: 0.15 },
];

function scoreAuthority(jobTitle: string | null, weight: number): DimensionScore {
  if (!jobTitle) {
    return { score: Math.round(weight * 0.3), reasoning: "No job title available -- scored conservatively" };
  }
  for (const tier of TITLE_TIERS) {
    if (tier.patterns.some((p) => p.test(jobTitle))) {
      const score = Math.round(weight * tier.pct);
      const level = tier.pct > 0.7 ? "senior decision maker" : tier.pct > 0.4 ? "mid-level role" : "junior role";
      return { score, reasoning: `${jobTitle} is a ${level}` };
    }
  }
  return { score: Math.round(weight * 0.3), reasoning: `${jobTitle} -- unknown seniority, scored mid-range` };
}

// ── Budget scoring ──────────────────────────────────────────────────────────

function scoreBudget(
  dealAmount: number | null,
  industry: string | null,
  isReferral: boolean,
  weight: number
): DimensionScore {
  let pct = 0;
  const reasons: string[] = [];

  // Deal amount signal (0-40% of weight)
  if (dealAmount && dealAmount > 0) {
    if (dealAmount >= 100000) { pct += 0.4; reasons.push(`deal worth ${dealAmount.toLocaleString()}`); }
    else if (dealAmount >= 50000) { pct += 0.3; reasons.push(`deal worth ${dealAmount.toLocaleString()}`); }
    else if (dealAmount >= 10000) { pct += 0.2; reasons.push(`deal worth ${dealAmount.toLocaleString()}`); }
    else { pct += 0.1; reasons.push(`small deal (${dealAmount.toLocaleString()})`); }
  }

  // Industry signal (0-20% of weight)
  if (industry) {
    pct += 0.15;
    reasons.push(`in ${industry.replace(/_/g, " ").toLowerCase()} sector`);
  }

  // Referral bonus (20% of weight)
  if (isReferral) {
    pct += 0.2;
    reasons.push("referred lead (higher conversion likelihood)");
  }

  // Base score if no strong signals
  if (pct === 0) {
    pct = 0.15;
    reasons.push("limited budget signals available");
  }

  const score = Math.min(Math.round(weight * pct), weight);
  return { score, reasoning: reasons.join(", ") };
}

// ── Need scoring ────────────────────────────────────────────────────────────

function scoreNeed(
  emailCount: number,
  lastInteractionDaysAgo: number | null,
  isReferral: boolean,
  weight: number
): DimensionScore {
  let pct = 0;
  const reasons: string[] = [];

  // Interaction volume (0-30% of weight)
  if (emailCount >= 5) { pct += 0.3; reasons.push(`${emailCount} emails exchanged (high engagement)`); }
  else if (emailCount >= 2) { pct += 0.2; reasons.push(`${emailCount} emails exchanged`); }
  else if (emailCount >= 1) { pct += 0.1; reasons.push("1 email exchanged"); }
  else { reasons.push("no email history found"); }

  // Recency (0-30% of weight)
  if (lastInteractionDaysAgo !== null) {
    if (lastInteractionDaysAgo <= 7) { pct += 0.3; reasons.push("contacted in the last week"); }
    else if (lastInteractionDaysAgo <= 30) { pct += 0.18; reasons.push("contacted in the last month"); }
    else { pct += 0.06; reasons.push(`last contact ${lastInteractionDaysAgo} days ago`); }
  }

  // Referral bonus (20% of weight)
  if (isReferral) {
    pct += 0.2;
    reasons.push("referred lead (indicates existing need)");
  }

  if (pct === 0) {
    pct = 0.1;
    reasons.push("limited need signals");
  }

  const score = Math.min(Math.round(weight * pct), weight);
  return { score, reasoning: reasons.join(", ") };
}

// ── Timeline scoring ────────────────────────────────────────────────────────

function scoreTimeline(
  closeDateStr: string | null,
  hasUrgencyLanguage: boolean,
  weight: number
): DimensionScore {
  let pct = 0;
  const reasons: string[] = [];

  if (closeDateStr) {
    try {
      const closeDate = new Date(closeDateStr);
      const now = new Date();
      const daysUntilClose = Math.round((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilClose <= 30 && daysUntilClose >= 0) {
        pct += 0.7;
        reasons.push(`deal closing in ${daysUntilClose} days`);
      } else if (daysUntilClose <= 90 && daysUntilClose > 0) {
        pct += 0.4;
        reasons.push(`deal closing in ${daysUntilClose} days`);
      } else if (daysUntilClose < 0) {
        pct += 0.3;
        reasons.push(`close date was ${Math.abs(daysUntilClose)} days ago (overdue)`);
      } else {
        pct += 0.15;
        reasons.push(`close date in ${daysUntilClose} days (long timeline)`);
      }
    } catch {
      pct += 0.15;
      reasons.push("close date present but unclear");
    }
  } else {
    pct += 0.1;
    reasons.push("no close date set");
  }

  if (hasUrgencyLanguage) {
    pct += 0.2;
    reasons.push("urgency language detected in communications");
  }

  const score = Math.min(Math.round(weight * pct), weight);
  return { score, reasoning: reasons.join(", ") };
}

// ── Generic dimension scoring (for custom dimensions) ───────────────────────

/** Escape special Postgres LIKE/ILIKE characters */
function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function scoreGeneric(weight: number): DimensionScore {
  const score = Math.round(weight * 0.4);
  return { score, reasoning: "Custom dimension -- scored at baseline (no specific signals)" };
}

// ── Main scoring function ───────────────────────────────────────────────────

export async function scoreLead(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  options?: {
    forceRescore?: boolean;
    enrichmentData?: {
      company_size?: string;
      funding_info?: string;
      industry_notes?: string;
    };
  }
): Promise<LeadScoreResult | null> {
  // Check for existing score (skip if already scored and not forcing)
  if (!options?.forceRescore) {
    const { data: existing } = await db
      .from("lead_scores")
      .select("id, scored_at")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .single();

    if (existing) {
      console.log(`[lead-scoring] Contact ${contactId} already scored, skipping (use forceRescore to override)`);
      return null;
    }
  }

  // Read workspace scoring config
  const { data: workspace } = await db
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const dimensions: ScoringDimension[] =
    (settings.skyler_scoring_dimensions as ScoringDimension[] | undefined) ?? DEFAULT_SCORING_DIMENSIONS;
  const thresholds = (settings.skyler_scoring_thresholds as typeof DEFAULT_SCORING_THRESHOLDS | undefined)
    ?? DEFAULT_SCORING_THRESHOLDS;

  // Gather contact data from document_chunks
  const { data: contactChunks } = await db
    .from("document_chunks")
    .select("chunk_text, metadata")
    .eq("workspace_id", workspaceId)
    .eq("metadata->>source_type", "hubspot_contact")
    .eq("metadata->>external_id", contactId)
    .limit(1);

  const contactChunk = contactChunks?.[0];
  if (!contactChunk) {
    console.warn(`[lead-scoring] No contact chunk found for contact_id=${contactId}`);
    return null;
  }

  // Parse contact info from chunk_text
  const ct = contactChunk.chunk_text ?? "";
  const nameMatch = ct.match(/Name:\s*([^|]+)/);
  const emailMatch = ct.match(/Email:\s*([^|]+)/);
  const titleMatch = ct.match(/Job Title:\s*([^|]+)/);
  const companyMatch = ct.match(/Company:\s*([^|]+)/);
  const dealsMatch = ct.match(/Deals:\s*([^|]+)/);

  const contactName = nameMatch?.[1]?.trim() ?? "Unknown";
  const contactEmail = emailMatch?.[1]?.trim() ?? "";
  const jobTitle = titleMatch?.[1]?.trim() ?? null;
  const companyName = companyMatch?.[1]?.trim() ?? "";

  // Look up company info
  let companyId = "";
  let industry: string | null = null;
  if (companyName) {
    const { data: companyChunks } = await db
      .from("document_chunks")
      .select("chunk_text, metadata")
      .eq("workspace_id", workspaceId)
      .eq("metadata->>source_type", "hubspot_company")
      .ilike("chunk_text", `%${escapeIlike(companyName)}%`)
      .limit(1);

    if (companyChunks?.[0]) {
      companyId = (companyChunks[0].metadata as Record<string, unknown>)?.external_id as string ?? "";
      const indMatch = companyChunks[0].chunk_text?.match(/Industry:\s*([^|]+)/);
      industry = indMatch?.[1]?.trim() ?? null;
    }
  }

  // Look up deal info
  let dealAmount: number | null = null;
  let closeDateStr: string | null = null;
  const dealNames = dealsMatch?.[1]?.trim();
  if (dealNames) {
    const firstDeal = dealNames.split(",")[0].trim();
    const { data: dealChunks } = await db
      .from("document_chunks")
      .select("chunk_text, metadata")
      .eq("workspace_id", workspaceId)
      .eq("metadata->>source_type", "hubspot_deal")
      .ilike("chunk_text", `%${escapeIlike(firstDeal)}%`)
      .limit(1);

    if (dealChunks?.[0]) {
      const dm = dealChunks[0].metadata as Record<string, unknown>;
      dealAmount = dm.amount ? parseFloat(dm.amount as string) : null;
      closeDateStr = (dm.close_date as string) ?? null;
    }
  }

  // Check for referral signals in email chunks
  let isReferral = false;
  let referrerName: string | null = null;
  let referrerCompany: string | null = null;

  if (contactEmail) {
    const { data: emailChunks } = await db
      .from("document_chunks")
      .select("metadata")
      .eq("workspace_id", workspaceId)
      .in("metadata->>source_type", ["gmail_message", "outlook_email"])
      .eq("metadata->>referral_detected", "true")
      .ilike("chunk_text", `%${escapeIlike(contactEmail)}%`)
      .limit(1);

    if (emailChunks?.[0]) {
      const em = emailChunks[0].metadata as Record<string, unknown>;
      isReferral = true;
      referrerName = (em.referrer_name as string) ?? null;
      referrerCompany = (em.referrer_company as string) ?? null;
    }
  }

  // Count email interactions
  let emailCount = 0;
  let lastInteractionDaysAgo: number | null = null;
  if (contactName && contactName !== "Unknown") {
    const { count } = await db
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("metadata->>source_type", ["gmail_message", "outlook_email"])
      .ilike("chunk_text", `%${escapeIlike(contactName)}%`);

    emailCount = count ?? 0;

    // Check recency
    const { data: recentEmail } = await db
      .from("document_chunks")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .in("metadata->>source_type", ["gmail_message", "outlook_email"])
      .ilike("chunk_text", `%${escapeIlike(contactName)}%`)
      .order("created_at", { ascending: false })
      .limit(1);

    if (recentEmail?.[0]) {
      const lastDate = new Date(recentEmail[0].created_at);
      lastInteractionDaysAgo = Math.round((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // Check for urgency language
  let hasUrgencyLanguage = false;
  if (contactName && contactName !== "Unknown") {
    const { count: urgentCount } = await db
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("metadata->>source_type", ["gmail_message", "outlook_email"])
      .ilike("chunk_text", `%${escapeIlike(contactName)}%`)
      .or("chunk_text.ilike.%asap%,chunk_text.ilike.%urgent%,chunk_text.ilike.%this week%,chunk_text.ilike.%deadline%,chunk_text.ilike.%immediately%");

    hasUrgencyLanguage = (urgentCount ?? 0) > 0;
  }

  // Score each dimension
  const dimensionScores: Record<string, DimensionScore> = {};

  for (const dim of dimensions) {
    switch (dim.key) {
      case "budget":
        dimensionScores[dim.key] = scoreBudget(dealAmount, industry, isReferral, dim.weight);
        break;
      case "authority":
        dimensionScores[dim.key] = scoreAuthority(jobTitle, dim.weight);
        break;
      case "need":
        dimensionScores[dim.key] = scoreNeed(emailCount, lastInteractionDaysAgo, isReferral, dim.weight);
        break;
      case "timeline":
        dimensionScores[dim.key] = scoreTimeline(closeDateStr, hasUrgencyLanguage, dim.weight);
        break;
      default:
        dimensionScores[dim.key] = scoreGeneric(dim.weight);
    }
  }

  // Calculate total
  const totalScore = Object.values(dimensionScores).reduce((sum, d) => sum + d.score, 0);

  // Classify
  const classification: "hot" | "nurture" | "disqualified" =
    totalScore >= thresholds.hot ? "hot"
    : totalScore >= thresholds.nurture ? "nurture"
    : "disqualified";

  // Build reasoning
  const reasonParts: string[] = [];
  if (classification === "hot") {
    reasonParts.push(`Strong lead scoring ${totalScore}/100.`);
  } else if (classification === "nurture") {
    reasonParts.push(`Moderate lead scoring ${totalScore}/100 -- worth nurturing.`);
  } else {
    reasonParts.push(`Low-scoring lead at ${totalScore}/100.`);
  }

  // Add key highlights
  const topDim = Object.entries(dimensionScores).sort((a, b) => b[1].score - a[1].score)[0];
  if (topDim) {
    const dimLabel = dimensions.find((d) => d.key === topDim[0])?.label ?? topDim[0];
    reasonParts.push(`Strongest signal: ${dimLabel} (${topDim[1].reasoning}).`);
  }

  if (isReferral && referrerName) {
    reasonParts.push(`Referred by ${referrerName}${referrerCompany ? ` from ${referrerCompany}` : ""}, indicating strong buying intent.`);
  }

  const scoringReasoning = reasonParts.join(" ");

  // Upsert into lead_scores
  const { error } = await db
    .from("lead_scores")
    .upsert(
      {
        workspace_id: workspaceId,
        contact_id: contactId,
        contact_name: contactName,
        contact_email: contactEmail,
        company_name: companyName,
        company_id: companyId,
        dimension_scores: dimensionScores,
        total_score: totalScore,
        classification,
        is_referral: isReferral,
        referrer_name: referrerName,
        referrer_company: referrerCompany,
        scoring_reasoning: scoringReasoning,
        scored_at: new Date().toISOString(),
        last_rescored_at: options?.forceRescore ? new Date().toISOString() : null,
        score_version: 1,
        source: "hubspot",
      },
      { onConflict: "workspace_id,contact_id" }
    );

  if (error) {
    console.error(`[lead-scoring] Failed to upsert score for ${contactId}:`, error.message);
    return null;
  }

  console.log(`[lead-scoring] Scored ${contactName} (${contactId}): ${totalScore}/100 = ${classification}`);

  return {
    contact_id: contactId,
    contact_name: contactName,
    contact_email: contactEmail,
    company_name: companyName,
    company_id: companyId,
    dimension_scores: dimensionScores,
    total_score: totalScore,
    classification,
    is_referral: isReferral,
    referrer_name: referrerName,
    referrer_company: referrerCompany,
    scoring_reasoning: scoringReasoning,
  };
}

/**
 * Score all unscored HubSpot contacts in a workspace.
 * Used for bulk scoring after initial sync.
 */
export async function scoreAllContacts(
  db: SupabaseClient,
  workspaceId: string
): Promise<{ scored: number; skipped: number }> {
  // Get all HubSpot contact IDs
  const { data: contactChunks } = await db
    .from("document_chunks")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .eq("metadata->>source_type", "hubspot_contact");

  if (!contactChunks || contactChunks.length === 0) {
    return { scored: 0, skipped: 0 };
  }

  let scored = 0;
  let skipped = 0;

  for (const chunk of contactChunks) {
    const contactId = (chunk.metadata as Record<string, unknown>)?.external_id as string;
    if (!contactId) { skipped++; continue; }

    const result = await scoreLead(db, workspaceId, contactId);
    if (result) { scored++; } else { skipped++; }
  }

  console.log(`[lead-scoring] Bulk scoring complete: ${scored} scored, ${skipped} skipped`);
  return { scored, skipped };
}

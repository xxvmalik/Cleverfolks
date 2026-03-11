/**
 * Unified email classification pipeline.
 * Orchestrates the four-layer processing:
 *   Layer 0: Process-once guard (metadata check — zero cost)
 *   Layer 1: Header/sender pre-filter (deterministic — zero cost)
 *   Layer 2: Keyword referral filter (regex — zero cost)
 *   Layer 3: AI classification via Haiku (only ~10-20% of emails)
 *
 * Also runs reply detection (pure DB lookup, zero AI cost) for all emails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { shouldSkipEmail, hasReferralSignals } from "./email-prefilter";
import { detectReferral } from "./referral-detector";
import { detectPipelineReply } from "./reply-detector";

export type EmailPipelineStats = {
  totalEmails: number;
  alreadyProcessed: number;
  prefilterSkipped: number;
  keywordSkipped: number;
  sentToHaiku: number;
  referralsFound: number;
  repliesDetected: number;
};

/**
 * Classify a batch of newly-stored email chunks.
 * Call this after chunks are stored in document_chunks during sync.
 *
 * Each email is processed at most ONCE — the processing_status flag in
 * synced_documents metadata prevents reprocessing on subsequent syncs.
 */
export async function classifyNewEmails(
  db: SupabaseClient,
  workspaceId: string,
  emailRecords: Array<{
    documentId: string;
    externalId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>
): Promise<EmailPipelineStats> {
  const stats: EmailPipelineStats = {
    totalEmails: emailRecords.length,
    alreadyProcessed: 0,
    prefilterSkipped: 0,
    keywordSkipped: 0,
    sentToHaiku: 0,
    referralsFound: 0,
    repliesDetected: 0,
  };

  if (emailRecords.length === 0) return stats;

  // Layer 0: Process-once guard — check which documents are already processed
  const docIds = emailRecords.map((r) => r.documentId);
  const { data: existingDocs } = await db
    .from("synced_documents")
    .select("id, metadata")
    .in("id", docIds);

  const processedSet = new Set<string>();
  for (const doc of existingDocs ?? []) {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    if (meta.email_classified === true) {
      processedSet.add(doc.id);
    }
  }

  for (const record of emailRecords) {
    // Reply detection runs FIRST on EVERY email — before any filtering.
    // This is a pure DB lookup (zero AI cost) and must not be gated by
    // prefilter/keyword filters because prospect replies are often very
    // short ("I'm interested", "sure", "not now") and would be skipped
    // by the too_short prefilter otherwise.
    const replyResult = await detectPipelineReply(db, workspaceId, {
      content: record.content,
      metadata: record.metadata,
    });
    if (replyResult.is_reply) stats.repliesDetected++;

    // Layer 0: Skip already-processed documents (referral classification only)
    if (processedSet.has(record.documentId)) {
      stats.alreadyProcessed++;
      continue;
    }

    let referralDetected = false;
    let referrerName: string | null = null;
    let referrerCompany: string | null = null;
    let classificationMethod = "unknown";
    let skipReason: string | null = null;

    // Layer 1: Header/metadata pre-filter
    const prefilterResult = shouldSkipEmail(record.content, record.metadata);
    if (prefilterResult.skip) {
      stats.prefilterSkipped++;
      classificationMethod = "prefilter";
      skipReason = prefilterResult.reason;
    } else {
      // Layer 2: Keyword referral filter
      const hasSignals = hasReferralSignals(record.content);
      if (!hasSignals) {
        stats.keywordSkipped++;
        classificationMethod = "keyword_filter";
        skipReason = "no_referral_keywords";
      } else {
        // Layer 3: AI classification (Haiku)
        stats.sentToHaiku++;
        const result = await detectReferral(record.content);
        classificationMethod = "haiku";
        referralDetected = result.is_referral;
        referrerName = result.referrer_name ?? null;
        referrerCompany = result.referrer_company ?? null;
        if (referralDetected) stats.referralsFound++;
      }
    }

    // Mark document as classified in synced_documents metadata
    const { data: currentDoc } = await db
      .from("synced_documents")
      .select("metadata")
      .eq("id", record.documentId)
      .single();

    await db
      .from("synced_documents")
      .update({
        metadata: {
          ...((currentDoc?.metadata as Record<string, unknown>) ?? {}),
          email_classified: true,
          classified_at: new Date().toISOString(),
          classification_method: classificationMethod,
          skip_reason: skipReason,
          referral_checked: true,
          referral_detected: referralDetected,
          referrer_name: referrerName,
          referrer_company: referrerCompany,
        },
      })
      .eq("id", record.documentId);
  }

  // Log pipeline summary
  console.log(
    `[Email Pipeline] Sync complete: ` +
      `total=${stats.totalEmails} already_processed=${stats.alreadyProcessed} ` +
      `prefilter_skipped=${stats.prefilterSkipped} keyword_skipped=${stats.keywordSkipped} ` +
      `sent_to_haiku=${stats.sentToHaiku} referrals=${stats.referralsFound} ` +
      `replies=${stats.repliesDetected} ` +
      `est_cost=$${(stats.sentToHaiku * 0.003).toFixed(4)}`
  );

  return stats;
}

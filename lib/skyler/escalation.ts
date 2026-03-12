/**
 * Escalation rule checker for Skyler.
 * Evaluates configured escalation rules against a pipeline record.
 * Returns matching reasons + actions: notify, flag (mark escalated), pause (cadence).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notifications";

export type EscalationRules = {
  dealValueExceedsThreshold: boolean;
  dealValueThreshold: number;
  vipAccount: boolean;
  negativeSentiment: boolean;
  firstContact: boolean;
  cSuiteContact: boolean;
};

export type EscalationResult = {
  shouldEscalate: boolean;
  reasons: string[];
};

type PipelineContext = {
  pipelineId: string;
  workspaceId: string;
  contactName: string;
  contactEmail: string;
  companyName?: string;
  dealValue?: number;
  replyIntent?: string;
  cadenceStep?: number;
  isFirstContact?: boolean;
  contactTitle?: string;
};

const C_SUITE_PATTERNS = /\b(ceo|cto|cfo|coo|cmo|cio|cpo|chief|founder|co-founder|president|vp |vice president|managing director|partner)\b/i;

/**
 * Evaluate escalation rules against a pipeline context.
 * Returns whether escalation should trigger and the matching reasons.
 */
export function evaluateEscalationRules(
  rules: EscalationRules,
  ctx: PipelineContext
): EscalationResult {
  const reasons: string[] = [];

  // Rule: Deal value exceeds threshold
  if (rules.dealValueExceedsThreshold && ctx.dealValue && ctx.dealValue >= rules.dealValueThreshold) {
    reasons.push(`Deal value ($${ctx.dealValue.toLocaleString()}) exceeds threshold ($${rules.dealValueThreshold.toLocaleString()})`);
  }

  // Rule: Negative sentiment (objection)
  if (rules.negativeSentiment && ctx.replyIntent === "objection") {
    reasons.push(`Objection received from ${ctx.contactName}`);
  }

  // Rule: First contact (step 1 reply)
  if (rules.firstContact && ctx.isFirstContact) {
    reasons.push(`First contact reply from ${ctx.contactName}`);
  }

  // Rule: C-Suite contact
  if (rules.cSuiteContact && ctx.contactTitle && C_SUITE_PATTERNS.test(ctx.contactTitle)) {
    reasons.push(`C-Suite contact: ${ctx.contactName} (${ctx.contactTitle})`);
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  };
}

/**
 * Load escalation rules from workspace settings.
 */
export async function getEscalationRules(
  db: SupabaseClient,
  workspaceId: string
): Promise<EscalationRules> {
  const { data: ws } = await db
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  const workflow = (settings.skyler_workflow ?? {}) as Record<string, unknown>;
  const rules = (workflow.escalationRules ?? {}) as Partial<EscalationRules>;

  return {
    dealValueExceedsThreshold: rules.dealValueExceedsThreshold ?? true,
    dealValueThreshold: rules.dealValueThreshold ?? 5000,
    vipAccount: rules.vipAccount ?? true,
    negativeSentiment: rules.negativeSentiment ?? true,
    firstContact: rules.firstContact ?? true,
    cSuiteContact: rules.cSuiteContact ?? true,
  };
}

/**
 * Run escalation check: evaluate rules → flag pipeline → pause cadence → notify.
 * All three actions: notify + flag + pause.
 * Fire-and-forget — never throws.
 */
export async function checkAndEscalate(
  db: SupabaseClient,
  ctx: PipelineContext
): Promise<EscalationResult> {
  try {
    const rules = await getEscalationRules(db, ctx.workspaceId);
    const result = evaluateEscalationRules(rules, ctx);

    if (!result.shouldEscalate) return result;

    const now = new Date().toISOString();

    // 1. Flag the pipeline record as escalated + pause cadence
    await db
      .from("skyler_sales_pipeline")
      .update({
        escalated: true,
        escalation_reasons: result.reasons,
        escalated_at: now,
        cadence_paused: true,
        updated_at: now,
      })
      .eq("id", ctx.pipelineId);

    console.log(`[escalation] Escalated pipeline ${ctx.pipelineId}: ${result.reasons.join("; ")}`);

    // 2. Dispatch notification
    await dispatchNotification(db, {
      workspaceId: ctx.workspaceId,
      eventType: "escalation_triggered",
      pipelineId: ctx.pipelineId,
      title: `Escalation: ${ctx.contactName}${ctx.companyName ? ` at ${ctx.companyName}` : ""}`,
      body: result.reasons.join(". "),
      metadata: {
        contactName: ctx.contactName,
        contactEmail: ctx.contactEmail,
        companyName: ctx.companyName,
        reasons: result.reasons,
      },
    });

    return result;
  } catch (err) {
    console.error("[escalation] Check failed:", err instanceof Error ? err.message : err);
    return { shouldEscalate: false, reasons: [] };
  }
}

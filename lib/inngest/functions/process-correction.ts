/**
 * Correction Processing Pipeline (Stage 11, Part C).
 *
 * Processes corrections from:
 * - skyler/decision.rejected (Part A: user rejects a draft)
 * - skyler/correction.received (Part B: user corrects Skyler in chat)
 *
 * Pipeline: classify → extract scope → conflict check → store → derive rule → update dimensions
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { classifyCorrectionFull } from "@/lib/skyler/learning/correction-classifier";
import { storeCorrection } from "@/lib/skyler/learning/correction-store";
import { shiftDimension, type DimensionName, DIMENSIONS } from "@/lib/skyler/learning/behavioural-dimensions";
import { recordOutcome, inferTrackedTaskType } from "@/lib/skyler/learning/confidence-tracking";
import { draftEmail } from "@/lib/skyler/email-drafter";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { dispatchNotification } from "@/lib/skyler/notifications";

export const processCorrection = inngest.createFunction(
  {
    id: "skyler-process-correction",
    retries: 2,
  },
  [
    { event: "skyler/decision.rejected" },
    { event: "skyler/correction.received" },
  ],
  async ({ event, step }) => {
    const data = event.data as Record<string, unknown>;
    const workspaceId = data.workspaceId as string;
    const pipelineId = data.pipelineId as string | undefined;

    if (!workspaceId) {
      return { status: "skipped", reason: "missing_workspace_id" };
    }

    // Step 1: Check if user takeover (not a quality issue)
    const isUserTakeover = data.isUserTakeover === true;
    if (isUserTakeover) {
      console.log("[process-correction] User takeover — logging but not learning");
      return { status: "user_takeover", reason: "User wants to handle it themselves" };
    }

    // Step 2: Classify the correction
    const classification = await step.run("classify-correction", async () => {
      const correctionText = (data.rejectionReason ?? data.correctionText ?? "") as string;
      const originalAction = (data.originalAction ?? null) as Record<string, unknown> | null;

      // Get lead context for scope classification
      const db = createAdminSupabaseClient();
      let leadContext: { companyName?: string; industry?: string; dealStage?: string; dealValue?: number } | undefined;

      if (pipelineId) {
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("company_name, stage, deal_value")
          .eq("id", pipelineId)
          .single();

        if (pipeline) {
          leadContext = {
            companyName: pipeline.company_name,
            dealStage: pipeline.stage,
            dealValue: pipeline.deal_value,
          };
        }
      }

      return await classifyCorrectionFull(correctionText, originalAction, leadContext);
    });

    if (!classification) {
      return { status: "failed", reason: "classification_failed" };
    }

    // Step 3: Store the correction
    const correctionId = await step.run("store-correction", async () => {
      const db = createAdminSupabaseClient();
      const correctionText = (data.rejectionReason ?? data.correctionText ?? "") as string;
      const source = event.name === "skyler/decision.rejected" ? "rejection_reason" : "user_provided";

      return await storeCorrection(db, {
        workspaceId,
        leadId: pipelineId,
        correctionType: classification.correction_type,
        scope: classification.scope,
        originalAction: (data.originalAction as Record<string, unknown>) ?? null,
        correctionText,
        clarificationText: (data.clarificationText as string) ?? null,
        derivedRule: classification.derived_rule,
        contextMetadata: {
          eventName: event.name,
          decisionId: data.decisionId,
          leadContext: data.leadContext,
        },
        source,
        sourceDecisionId: (data.decisionId as string) ?? null,
      });
    });

    // Step 4: Update confidence tracking (for rejections)
    if (event.name === "skyler/decision.rejected") {
      await step.run("update-confidence", async () => {
        const db = createAdminSupabaseClient();
        const originalAction = (data.originalAction ?? {}) as Record<string, unknown>;
        const actionType = (originalAction.action_type as string) ?? "draft_email";

        const taskType = inferTrackedTaskType(actionType);
        if (taskType) {
          await recordOutcome(db, workspaceId, taskType, "rejected");
        }
      });
    }

    // Step 5: Update behavioural dimensions (for tone/style corrections)
    if (
      classification.affected_dimensions &&
      classification.affected_dimensions.length > 0 &&
      (classification.correction_type === "tone" || classification.correction_type === "style")
    ) {
      await step.run("update-dimensions", async () => {
        const db = createAdminSupabaseClient();
        for (const dim of classification.affected_dimensions!) {
          if (DIMENSIONS.includes(dim.dimension as DimensionName)) {
            await shiftDimension(
              db,
              workspaceId,
              dim.dimension as DimensionName,
              dim.direction
            );
          }
        }
      });
    }

    // ── Step 6: Re-draft email if this was a rejection (not user takeover) ──
    let redraftActionId: string | null = null;

    if (event.name === "skyler/decision.rejected" && pipelineId) {
      redraftActionId = await step.run("redraft-email", async () => {
        const db = createAdminSupabaseClient();

        // Load pipeline record for context
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", pipelineId)
          .single();

        if (!pipeline) {
          console.log(`[process-correction] Pipeline ${pipelineId} not found, skipping re-draft`);
          return null;
        }

        const rejectionReason = (data.rejectionReason ?? "") as string;
        const originalAction = (data.originalAction ?? {}) as Record<string, unknown>;
        const thread = (pipeline.conversation_thread ?? []) as Array<{
          role: string;
          content: string;
          subject?: string;
          timestamp: string;
        }>;

        try {
          // Re-draft with rejection feedback as correction context
          const newDraft = await draftEmail({
            workspaceId,
            pipelineRecord: {
              id: pipelineId,
              contact_name: pipeline.contact_name,
              contact_email: pipeline.contact_email,
              company_name: pipeline.company_name,
              stage: pipeline.stage,
              cadence_step: pipeline.cadence_step,
              conversation_thread: thread,
            },
            cadenceStep: pipeline.cadence_step ?? 1,
            companyResearch: null as unknown as Parameters<typeof draftEmail>[0]["companyResearch"],
            salesVoice: null,
            conversationThread: thread,
            workspaceMemories: [],
            userFeedback: `IMPORTANT — The user rejected the previous draft. Their feedback: "${rejectionReason}". Previous subject: "${(originalAction.subject as string) ?? ""}". Redraft incorporating this feedback.`,
          });

          // Store as a new pending action
          const result = await draftOutreachEmail(db, {
            workspaceId,
            pipelineId,
            to: pipeline.contact_email,
            subject: newDraft.subject,
            htmlBody: newDraft.htmlBody,
            textBody: newDraft.textBody,
          });

          // Notify user that a new draft is ready
          await dispatchNotification(db, {
            workspaceId,
            eventType: "draft_awaiting_approval",
            pipelineId,
            title: `Revised draft ready: ${pipeline.contact_name ?? pipeline.contact_email}`,
            body: `I've redrafted the email based on your feedback. Please review.`,
            metadata: {
              contactName: pipeline.contact_name,
              contactEmail: pipeline.contact_email,
              companyName: pipeline.company_name,
              isRevision: true,
              rejectionReason,
            },
          });

          console.log(`[process-correction] Re-drafted email for pipeline ${pipelineId}: ${result.actionId}`);
          return result.actionId;
        } catch (draftErr) {
          console.error(`[process-correction] Re-draft failed for ${pipelineId}:`, draftErr);
          return null;
        }
      });
    }

    return {
      status: "processed",
      correctionId,
      redraftActionId,
      type: classification.correction_type,
      scope: classification.scope,
      rule: classification.derived_rule,
    };
  }
);

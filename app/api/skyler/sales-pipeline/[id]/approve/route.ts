/**
 * Approve a pending email draft for a pipeline record.
 * Sends Inngest event + executes the email send + syncs to HubSpot.
 * Also captures golden example + updates confidence tracking (Stage 11).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { executeEmailSend } from "@/lib/email/email-sender";
import { inngest } from "@/lib/inngest/client";
import { syncEmailSentToHubSpot } from "@/lib/hubspot/crm-sync";
import { createGoldenExample } from "@/lib/skyler/learning/golden-examples";
import { recordOutcome, inferTrackedTaskType } from "@/lib/skyler/learning/confidence-tracking";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pipelineId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const actionId = body.actionId as string | undefined;

  const db = createAdminSupabaseClient();

  // Find the pending action for this pipeline
  let targetActionId = actionId;
  if (!targetActionId) {
    const { data: actions } = await db
      .from("skyler_actions")
      .select("id, tool_input")
      .eq("tool_name", "send_email")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const match = (actions ?? []).find((a) => {
      const input = a.tool_input as Record<string, unknown>;
      return input?.pipelineId === pipelineId;
    });

    if (!match) {
      return NextResponse.json({ error: "No pending email draft found for this pipeline record" }, { status: 404 });
    }
    targetActionId = match.id;
  }

  if (!targetActionId) {
    return NextResponse.json({ error: "No action ID resolved" }, { status: 404 });
  }

  try {
    const { messageId } = await executeEmailSend(db, targetActionId);

    // Send Inngest event so the workflow can continue (non-blocking)
    try {
      await inngest.send({
        name: "skyler/email.approved",
        data: { pipelineId, actionId: targetActionId, messageId },
      });
    } catch (inngestErr) {
      console.error("[approve] Inngest event failed (email still sent):", inngestErr);
    }

    // ── Stage 11: Golden example + confidence tracking (fire-and-forget) ──
    try {
      // Find the skyler_decisions record linked to this action
      const { data: decision } = await db
        .from("skyler_decisions")
        .select("id, decision, created_at, pipeline_id, workspace_id")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (decision) {
        const decisionData = decision.decision as Record<string, unknown>;
        const approvalSpeedMs = Date.now() - new Date(decision.created_at).getTime();
        const approvalSpeedSeconds = Math.round(approvalSpeedMs / 1000);

        // Update decision record with approval speed
        await db
          .from("skyler_decisions")
          .update({
            approval_speed_seconds: approvalSpeedSeconds,
            action_id: targetActionId,
          })
          .eq("id", decision.id);

        // Create golden example
        const actionType = (decisionData.action_type as string) ?? "draft_email";
        await createGoldenExample(db, {
          workspaceId: decision.workspace_id,
          leadId: pipelineId,
          decisionId: decision.id,
          taskType: actionType,
          inputContext: {
            stage: decisionData.parameters ? "unknown" : "unknown",
            eventType: actionType,
          },
          agentOutput: decisionData,
          approvalSpeedSeconds,
          editDistance: 0.0, // No edit tracking yet — will be added when edit UI is built
        });

        // Update confidence tracking
        const taskType = inferTrackedTaskType(actionType, {
          isObjection: !!(decisionData.parameters as Record<string, unknown>)?.is_objection_response,
          isMeetingFollowup: !!(decisionData.parameters as Record<string, unknown>)?.is_meeting_request,
        });
        if (taskType) {
          await recordOutcome(db, decision.workspace_id, taskType, "approved");
        }
      }
    } catch (learningErr) {
      console.error("[approve] Learning capture failed (email still sent):", learningErr);
    }

    // Fire-and-forget CRM sync to HubSpot
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("contact_email, contact_name, company_name, cadence_step, stage, hubspot_deal_id")
      .eq("id", pipelineId)
      .single();

    if (pipeline) {
      const { data: action } = await db
        .from("skyler_actions")
        .select("tool_input")
        .eq("id", targetActionId)
        .single();

      const emailInput = (action?.tool_input ?? {}) as Record<string, unknown>;

      // Don't await — fire-and-forget
      syncEmailSentToHubSpot({
        workspaceId: (await db.from("skyler_sales_pipeline").select("workspace_id").eq("id", pipelineId).single()).data?.workspace_id ?? "",
        pipelineId,
        contactEmail: pipeline.contact_email,
        contactName: pipeline.contact_name ?? pipeline.contact_email,
        companyName: pipeline.company_name ?? undefined,
        subject: (emailInput.subject as string) ?? "outreach",
        body: (emailInput.textBody as string) ?? "",
        cadenceStep: pipeline.cadence_step ?? 1,
        pipelineStage: pipeline.stage ?? "initial_outreach",
        hubspotDealId: pipeline.hubspot_deal_id,
      }).catch((err) => console.error("[approve] CRM sync failed:", err));
    }

    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Action stays as 'pending' so user can retry
    return NextResponse.json({ error: msg, retryable: true }, { status: 500 });
  }
}

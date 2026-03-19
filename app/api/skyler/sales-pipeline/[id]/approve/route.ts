/**
 * Approve a pending email draft for a pipeline record.
 * Sends Inngest event + executes the email send + syncs to HubSpot.
 * Also captures golden example + updates confidence tracking (Stage 11).
 *
 * If `editedBody` is provided, persists user edits to the action before sending,
 * computes edit distance, and stores the diff as a learning signal.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { executeEmailSend } from "@/lib/email/email-sender";
import { inngest } from "@/lib/inngest/client";
import { syncEmailSentToHubSpot } from "@/lib/hubspot/crm-sync";
import { createGoldenExample } from "@/lib/skyler/learning/golden-examples";
import { recordOutcome, inferTrackedTaskType } from "@/lib/skyler/learning/confidence-tracking";

/** Simple normalised edit distance (Levenshtein ratio) between two strings */
function computeEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  // For very long texts, use a cheaper char-diff approximation
  if (maxLen > 5000) {
    const wordsA = a.split(/\s+/);
    const wordsB = b.split(/\s+/);
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    let common = 0;
    for (const w of setA) if (setB.has(w)) common++;
    const total = new Set([...wordsA, ...wordsB]).size;
    return total === 0 ? 0 : 1 - common / total;
  }

  // Standard Levenshtein for reasonable-length texts
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n] / maxLen;
}

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
  const editedBody = body.editedBody as string | undefined;
  const isRetry = body.retry === true;

  const db = createAdminSupabaseClient();

  // ── Security: verify user belongs to the workspace that owns this pipeline record ──
  const { data: pipelineRecord } = await db
    .from("skyler_sales_pipeline")
    .select("workspace_id")
    .eq("id", pipelineId)
    .single();

  if (!pipelineRecord) {
    return NextResponse.json({ error: "Pipeline record not found" }, { status: 404 });
  }

  const workspaceId = pipelineRecord.workspace_id as string;

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Find the pending (or failed, if retrying) action for this pipeline
  const validStatuses = isRetry ? ["pending", "failed"] : ["pending"];
  let targetActionId = actionId;
  if (!targetActionId) {
    const { data: actions } = await db
      .from("skyler_actions")
      .select("id, tool_input, status")
      .eq("tool_name", "send_email")
      .in("status", validStatuses)
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

  // If retrying a failed action, reset it to pending first
  if (isRetry) {
    await db
      .from("skyler_actions")
      .update({ status: "pending", result: null, updated_at: new Date().toISOString() })
      .eq("id", targetActionId)
      .eq("status", "failed");
  }

  // ── If user edited the draft, persist edits before sending ──
  let editDistance = 0;
  if (editedBody !== undefined && editedBody !== null) {
    // Load original draft for diff computation
    const { data: origAction } = await db
      .from("skyler_actions")
      .select("tool_input")
      .eq("id", targetActionId)
      .single();

    const origInput = (origAction?.tool_input ?? {}) as Record<string, unknown>;
    const originalText = (origInput.textBody as string) ?? "";

    editDistance = computeEditDistance(originalText, editedBody);

    // Update the action's tool_input with user's edited text
    const updatedInput = {
      ...origInput,
      textBody: editedBody,
      htmlBody: editedBody.replace(/\n/g, "<br/>"),
      _originalTextBody: originalText, // Preserve original for learning
      _editDistance: editDistance,
      _editedByUser: true,
      _editedAt: new Date().toISOString(),
    };

    await db
      .from("skyler_actions")
      .update({ tool_input: updatedInput, updated_at: new Date().toISOString() })
      .eq("id", targetActionId)
      .eq("status", "pending");

    console.log(`[approve] User edited draft ${targetActionId} — edit distance: ${editDistance.toFixed(3)}`);
  }

  try {
    const { messageId } = await executeEmailSend(db, targetActionId);

    // Send Inngest event so the workflow can continue (non-blocking)
    try {
      await inngest.send({
        name: "skyler/email.approved",
        data: { pipelineId, actionId: targetActionId, messageId, editDistance },
      });
    } catch (inngestErr) {
      console.error("[approve] Inngest event failed (email still sent):", inngestErr);
    }

    // ── Stage 11: Golden example + confidence tracking (fire-and-forget) ──
    try {
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

        // Create golden example with real edit distance
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
          editDistance,
        });

        // If the user edited significantly, store a learning signal as a workspace memory
        if (editDistance > 0.1 && editedBody) {
          const origAction = await db
            .from("skyler_actions")
            .select("tool_input")
            .eq("id", targetActionId)
            .single();

          const origText = ((origAction.data?.tool_input as Record<string, unknown>)?._originalTextBody as string) ?? "";

          await db.from("workspace_memories").insert({
            workspace_id: workspaceId,
            scope: "workspace",
            type: "correction",
            content: `Email editing pattern — Skyler drafted: "${origText.slice(0, 200)}..." → User changed to: "${editedBody.slice(0, 200)}..." (edit distance: ${editDistance.toFixed(2)}). Learn from the user's style preferences.`,
            confidence: "medium",
            source_conversation_id: null,
            created_by: user.id,
          });

          console.log(`[approve] Stored edit learning signal for workspace ${workspaceId}`);
        }

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

    // Fire-and-forget CRM sync to HubSpot (using workspace_id from earlier query)
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

      syncEmailSentToHubSpot({
        workspaceId,
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
    return NextResponse.json({ error: msg, retryable: true }, { status: 500 });
  }
}

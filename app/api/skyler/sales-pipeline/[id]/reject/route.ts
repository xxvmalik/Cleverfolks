/**
 * Reject a pending email draft with REQUIRED correction feedback.
 * Stores rejection reason on skyler_decisions and emits Inngest event
 * for the correction processing pipeline (Stage 11).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pipelineId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { actionId, feedback } = body as { actionId?: string; feedback?: string };

  // Feedback is required for Stage 11 learning
  if (!feedback?.trim()) {
    return NextResponse.json(
      { error: "Rejection reason is required. Please tell Skyler why you're rejecting this." },
      { status: 400 }
    );
  }

  const db = createAdminSupabaseClient();

  // Find the pending action
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
      return NextResponse.json({ error: "No pending email draft found" }, { status: 404 });
    }
    targetActionId = match.id;
  }

  // Reject the action
  await db
    .from("skyler_actions")
    .update({
      status: "rejected",
      result: { feedback: feedback.trim() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetActionId)
    .eq("status", "pending");

  // Fetch the action to get workspace_id and the original draft
  const { data: action } = await db
    .from("skyler_actions")
    .select("workspace_id, tool_input, tool_name, created_at")
    .eq("id", targetActionId)
    .single();

  const workspaceId = action?.workspace_id;

  if (workspaceId) {
    // Detect "user takeover" — user wants to handle it themselves, not a quality issue
    const lowerFeedback = feedback.trim().toLowerCase();
    const takeover = /\b(i'?ll handle|i'?ll do it|i'?ll take|my ?self|leave it to me|i got this|let me handle)\b/.test(lowerFeedback);

    // Store rejection reason on the skyler_decisions record linked to this action
    const { data: decisionRecord } = await db
      .from("skyler_decisions")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (decisionRecord) {
      await db
        .from("skyler_decisions")
        .update({
          rejection_reason: feedback.trim(),
          action_id: targetActionId,
        })
        .eq("id", decisionRecord.id);
    }

    // Store as workspace memory for backward compatibility
    await db.from("workspace_memories").insert({
      workspace_id: workspaceId,
      scope: "workspace",
      type: "correction",
      content: `Email drafting feedback: ${feedback.trim()}`,
      confidence: "high",
      source_conversation_id: null,
      created_by: user.id,
    });

    // Emit Inngest event for the correction processing pipeline
    try {
      await inngest.send({
        name: "skyler/decision.rejected",
        data: {
          decisionId: decisionRecord?.id ?? null,
          actionId: targetActionId,
          pipelineId,
          workspaceId,
          rejectionReason: feedback.trim(),
          isUserTakeover: takeover,
          originalAction: action?.tool_input ?? {},
          rejectedAt: new Date().toISOString(),
        },
      });
    } catch (inngestErr) {
      console.error("[reject] Inngest event failed (rejection still recorded):", inngestErr);
    }
  }

  return NextResponse.json({ ok: true, status: "rejected" });
}

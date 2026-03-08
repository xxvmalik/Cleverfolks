/**
 * Reject a pending email draft with optional correction feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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
      result: feedback ? { feedback } : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetActionId)
    .eq("status", "pending");

  // If feedback provided, store it as a workspace memory for voice correction
  if (feedback) {
    const { data: action } = await db
      .from("skyler_actions")
      .select("workspace_id")
      .eq("id", targetActionId)
      .single();

    if (action?.workspace_id) {
      await db.from("workspace_memories").insert({
        workspace_id: action.workspace_id,
        scope: "workspace",
        type: "correction",
        content: `Email drafting feedback: ${feedback}`,
        confidence: "high",
        source_conversation_id: null,
        created_by: user.id,
      });
    }
  }

  return NextResponse.json({ ok: true, status: "rejected" });
}

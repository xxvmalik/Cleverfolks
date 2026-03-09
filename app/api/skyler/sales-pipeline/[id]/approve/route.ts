/**
 * Approve a pending email draft for a pipeline record.
 * Sends Inngest event + executes the email send.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { executeEmailSend } from "@/lib/email/resend-client";
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
    const { resendId } = await executeEmailSend(db, targetActionId);

    // Send Inngest event so the workflow can continue (non-blocking)
    try {
      await inngest.send({
        name: "skyler/email.approved",
        data: { pipelineId, actionId: targetActionId, resendId },
      });
    } catch (inngestErr) {
      console.error("[approve] Inngest event failed (email still sent):", inngestErr);
    }

    return NextResponse.json({ ok: true, resendId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Action stays as 'pending' so user can retry
    return NextResponse.json({ error: msg, retryable: true }, { status: 500 });
  }
}

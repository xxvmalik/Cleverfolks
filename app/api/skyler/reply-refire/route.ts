/**
 * POST /api/skyler/reply-refire?pipelineId=xxx
 *
 * Re-fires the skyler/pipeline.reply.received Inngest event for a pipeline
 * that already has the reply in its thread but the draft was never created
 * (e.g., because handlePipelineReply skipped it due to a resolution check).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

export { handler as GET, handler as POST };

async function handler(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Verify pipeline exists and belongs to user's workspace
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, workspace_id, stage, resolution, conversation_thread")
    .eq("id", pipelineId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  // Clear resolution if it's one of the "still active" types
  if (["meeting_booked", "demo_booked", "no_response"].includes(pipeline.resolution ?? "")) {
    await db
      .from("skyler_sales_pipeline")
      .update({
        resolution: null,
        resolution_notes: null,
        resolved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipelineId);
  }

  // Get the last prospect reply from the thread
  const thread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
  const lastProspectReply = [...thread].reverse().find((e) => e.role === "prospect");
  const replyContent = (lastProspectReply?.content as string) ?? "";

  await inngest.send({
    name: "skyler/pipeline.reply.received",
    data: {
      pipelineId: pipeline.id,
      contactEmail: pipeline.contact_email,
      workspaceId: membership.workspace_id,
      replyContent,
      stage: pipeline.stage,
    },
  });

  return NextResponse.json({
    status: "event_fired",
    pipelineId,
    contactEmail: pipeline.contact_email,
    resolutionCleared: ["meeting_booked", "demo_booked", "no_response"].includes(pipeline.resolution ?? ""),
  });
}

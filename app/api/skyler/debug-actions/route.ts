/**
 * GET /api/skyler/debug-actions?pipelineId=xxx
 * Shows all skyler_actions for a pipeline to debug why drafts aren't visible.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // All actions for this pipeline (any status)
  const { data: allActions, error: actionsErr } = await db
    .from("skyler_actions")
    .select("id, pipeline_id, tool_name, tool_input, description, status, result, created_at, updated_at")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Also check by tool_input.pipelineId (old format)
  const { data: allActionsByInput } = await db
    .from("skyler_actions")
    .select("id, pipeline_id, tool_name, description, status, created_at")
    .eq("tool_name", "send_email")
    .in("status", ["pending", "failed"])
    .limit(50);

  const matchedByInput = (allActionsByInput ?? []).filter((a) => {
    const input = a.tool_input as Record<string, unknown> | undefined;
    return input?.pipelineId === pipelineId;
  });

  // All notifications for this pipeline
  const { data: notifications } = await db
    .from("skyler_notifications")
    .select("id, event_type, title, body, read, created_at")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Pipeline record state
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, contact_email, stage, resolution, awaiting_reply, last_reply_at, updated_at")
    .eq("id", pipelineId)
    .single();

  return NextResponse.json({
    pipeline,
    actions: {
      byPipelineId: allActions ?? [],
      byToolInput: matchedByInput,
      error: actionsErr?.message ?? null,
    },
    notifications: notifications ?? [],
  });
}

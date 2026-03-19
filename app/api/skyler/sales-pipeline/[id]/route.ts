/**
 * Single pipeline record: GET (detail), PATCH (update stage/resolution)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { validateAndLog } from "@/lib/skyler/pipeline/state-machine";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from("skyler_sales_pipeline")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Security: verify user belongs to this pipeline's workspace
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", data.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Also fetch email events
  const { data: events } = await db
    .from("skyler_email_events")
    .select("*")
    .eq("pipeline_id", id)
    .order("created_at", { ascending: true });

  // Fetch pending + failed actions (failed shown with retry option)
  const { data: actions } = await db
    .from("skyler_actions")
    .select("id, description, tool_input, status, result, created_at")
    .eq("tool_name", "send_email")
    .in("status", ["pending", "failed"]);

  const pendingActions = (actions ?? []).filter((a) => {
    const input = a.tool_input as Record<string, unknown>;
    return input?.pipelineId === id;
  });

  return NextResponse.json({
    record: data,
    events: events ?? [],
    pending_actions: pendingActions,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { stage, resolution, resolution_notes, dismiss_note } = body;

  const db = createAdminSupabaseClient();

  // Security: verify user belongs to this pipeline's workspace
  const { data: pipelineCheck } = await db
    .from("skyler_sales_pipeline")
    .select("workspace_id")
    .eq("id", id)
    .single();

  if (!pipelineCheck) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: memberCheck } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", pipelineCheck.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!memberCheck) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (stage) {
    // Get current stage for FSM validation
    const { data: current } = await db
      .from("skyler_sales_pipeline")
      .select("stage")
      .eq("id", id)
      .single();
    const fromStage = (current?.stage as string) ?? "unknown";

    const check = await validateAndLog(id, fromStage, stage, "user_action", "manual PATCH");
    if (!check.valid) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }
    updates.stage = stage;
  }
  if (resolution) {
    updates.resolution = resolution;
    updates.resolved_at = new Date().toISOString();
  }
  if (resolution_notes) updates.resolution_notes = resolution_notes;

  // Dismiss skyler_note: mark as resolved
  if (dismiss_note) {
    const { data: current } = await db
      .from("skyler_sales_pipeline")
      .select("skyler_note")
      .eq("id", id)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingNote = (current?.skyler_note ?? {}) as Record<string, any>;
    updates.skyler_note = { ...existingNote, resolved: true, resolved_at: new Date().toISOString() };
  }

  const { error } = await db
    .from("skyler_sales_pipeline")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/**
 * Sales Pipeline API: GET (list), POST (add lead manually)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";
import { STAGES } from "@/lib/skyler/pipeline-stages";

async function resolveWorkspaceId(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  explicit?: string | null
): Promise<string | null> {
  if (explicit) return explicit;
  const { data } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.workspace_id ?? null;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(
    supabase, user.id, req.nextUrl.searchParams.get("workspaceId")
  );
  if (!workspaceId) return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const stage = req.nextUrl.searchParams.get("stage");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  const db = createAdminSupabaseClient();
  let query = db
    .from("skyler_sales_pipeline")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (stage && stage !== "all") {
    query = query.eq("stage", stage);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also fetch pending actions for these pipeline records
  const pipelineIds = (data ?? []).map((p) => p.id);
  let pendingActions: Record<string, unknown>[] = [];
  if (pipelineIds.length > 0) {
    const { data: actions } = await db
      .from("skyler_actions")
      .select("id, pipeline_id, description, tool_input, status, result, created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "failed"])
      .in("pipeline_id", pipelineIds)
      .order("created_at", { ascending: false });
    pendingActions = actions ?? [];
  }

  // Fetch active directives for these pipeline records
  let directivesByPipeline: Record<string, number> = {};
  if (pipelineIds.length > 0) {
    const { data: directives } = await db
      .from("skyler_directives")
      .select("pipeline_id")
      .in("pipeline_id", pipelineIds)
      .eq("is_active", true);
    for (const d of directives ?? []) {
      directivesByPipeline[d.pipeline_id] = (directivesByPipeline[d.pipeline_id] ?? 0) + 1;
    }
  }

  // Fetch pending requests for these pipeline records
  let requestsByPipeline: Record<string, Array<Record<string, unknown>>> = {};
  if (pipelineIds.length > 0) {
    const { data: requests } = await db
      .from("skyler_requests")
      .select("id, pipeline_id, request_description, created_at")
      .in("pipeline_id", pipelineIds)
      .eq("status", "pending");
    for (const r of requests ?? []) {
      const pId = r.pipeline_id as string;
      if (!requestsByPipeline[pId]) requestsByPipeline[pId] = [];
      requestsByPipeline[pId].push(r);
    }
  }

  // Map pending actions to their pipeline records
  const actionsByPipeline: Record<string, Array<Record<string, unknown>>> = {};
  for (const action of pendingActions) {
    const pId = (action.pipeline_id ?? (action.tool_input as Record<string, unknown>)?.pipelineId) as string;
    if (pId) {
      if (!actionsByPipeline[pId]) actionsByPipeline[pId] = [];
      actionsByPipeline[pId].push(action);
    }
  }

  // Count meetings per pipeline record
  let meetingsByPipeline: Record<string, number> = {};
  if (pipelineIds.length > 0) {
    const { data: meetings } = await db
      .from("meeting_transcripts")
      .select("lead_id")
      .in("lead_id", pipelineIds);
    for (const m of meetings ?? []) {
      const pId = m.lead_id as string;
      meetingsByPipeline[pId] = (meetingsByPipeline[pId] ?? 0) + 1;
    }
  }

  const records = (data ?? []).map((p) => ({
    ...p,
    pending_actions: actionsByPipeline[p.id] ?? [],
    directive_count: directivesByPipeline[p.id] ?? 0,
    pending_requests: requestsByPipeline[p.id] ?? [],
    meeting_count: meetingsByPipeline[p.id] ?? 0,
  }));

  return NextResponse.json({ records });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { contactId, contactEmail, contactName, companyName, companyId } = body;

  if (!contactEmail) {
    return NextResponse.json({ error: "contactEmail is required" }, { status: 400 });
  }

  const workspaceId = await resolveWorkspaceId(
    supabase, user.id, body.workspaceId
  );
  if (!workspaceId) return NextResponse.json({ error: "No workspace found" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Check for existing record
  const { data: existing } = await db
    .from("skyler_sales_pipeline")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_email", contactEmail)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Contact already in pipeline", id: existing.id }, { status: 409 });
  }

  const { data, error } = await db
    .from("skyler_sales_pipeline")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId ?? contactEmail,
      contact_name: contactName ?? contactEmail,
      contact_email: contactEmail,
      company_name: companyName ?? null,
      company_id: companyId ?? null,
      stage: STAGES.INITIAL_OUTREACH,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger Sales Closer workflow
  await inngest.send({
    name: "skyler/lead.qualified.hot",
    data: {
      contactId: contactId ?? contactEmail,
      contactEmail,
      contactName: contactName ?? contactEmail,
      companyName: companyName ?? null,
      companyId: companyId ?? null,
      workspaceId,
      leadScoreId: null,
      pipelineId: data!.id,
    },
  });

  return NextResponse.json({ id: data!.id, status: "created" }, { status: 201 });
}

/** PATCH — Dismiss a pending request (set status = 'dismissed') */
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { requestId } = await req.json();
  if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from("skyler_requests")
    .update({ status: "dismissed" })
    .eq("id", requestId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

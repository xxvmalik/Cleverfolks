/**
 * Sales Pipeline API: GET (list), POST (add lead manually)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

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

  // Also fetch pending email actions for these pipeline records
  const pipelineIds = (data ?? []).map((p) => p.id);
  let pendingActions: Record<string, unknown>[] = [];
  if (pipelineIds.length > 0) {
    const { data: actions } = await db
      .from("skyler_actions")
      .select("id, description, tool_input, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("tool_name", "send_email")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    pendingActions = actions ?? [];
  }

  // Map pending actions to their pipeline records
  const actionsByPipeline: Record<string, Array<Record<string, unknown>>> = {};
  for (const action of pendingActions) {
    const pId = (action.tool_input as Record<string, unknown>)?.pipelineId as string;
    if (pId) {
      if (!actionsByPipeline[pId]) actionsByPipeline[pId] = [];
      actionsByPipeline[pId].push(action);
    }
  }

  const records = (data ?? []).map((p) => ({
    ...p,
    pending_actions: actionsByPipeline[p.id] ?? [],
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
      stage: "initial_outreach",
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

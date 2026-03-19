import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = request.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  const { data, error } = await db
    .from("skyler_directives")
    .select("id, directive_text, created_at, is_active")
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ directives: data ?? [] });
}

export async function POST(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { pipelineId, directiveText } = body as { pipelineId?: string; directiveText?: string };

  if (!pipelineId || !directiveText?.trim()) {
    return NextResponse.json({ error: "pipelineId and directiveText required" }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  // Get workspace_id from the pipeline record
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("workspace_id")
    .eq("id", pipelineId)
    .single();

  if (!pipeline) return NextResponse.json({ error: "Pipeline record not found" }, { status: 404 });

  const { data: directive, error } = await db
    .from("skyler_directives")
    .insert({
      workspace_id: pipeline.workspace_id,
      pipeline_id: pipelineId,
      directive_text: directiveText.trim(),
    })
    .select("id, directive_text, created_at, is_active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ directive });
}

export async function DELETE(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const directiveId = request.nextUrl.searchParams.get("id");
  if (!directiveId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  const { error } = await db
    .from("skyler_directives")
    .update({ is_active: false })
    .eq("id", directiveId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

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

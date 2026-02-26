import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

// ── POST /api/knowledge-profile — trigger a profile build ────────────────────
export async function POST(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspaceId } = body;
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify workspace membership
  const { data: membership } = await authClient
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await inngest.send({
    name: "knowledge/profile.build",
    data: { workspaceId },
  });

  return Response.json({ ok: true, message: "Knowledge profile build triggered" });
}

// ── GET /api/knowledge-profile?workspaceId=... — fetch current profile ────────
export async function GET(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify workspace membership
  const { data: membership } = await authClient
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from("knowledge_profiles")
    .select("profile, status, last_built_at, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    profile: data?.profile ?? null,
    status: data?.status ?? "idle",
    last_built_at: data?.last_built_at ?? null,
    updated_at: data?.updated_at ?? null,
  });
}

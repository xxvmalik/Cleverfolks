import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── GET /api/knowledge-profile/confirm?workspaceId=... ───────────────────────
// Returns the current confirmation status plus team members with their
// detected roles and confidence levels so the UI can render the review card.

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
  const [profileRes, confirmationRes] = await Promise.all([
    db
      .from("knowledge_profiles")
      .select("profile, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("profile_confirmations")
      .select("confirmed_at, corrections")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const profile = profileRes.data?.profile as Record<string, unknown> | null;
  const status = profileRes.data?.status ?? "idle";

  const teamMembers = (
    (profile?.team_members as Array<{
      name: string;
      detected_role?: string;
      likely_role?: string;
      confidence?: string;
    }> | undefined) ?? []
  ).map((m) => ({
    name: m.name,
    detected_role: m.detected_role ?? m.likely_role ?? "",
    confidence: m.confidence ?? "medium",
  }));

  return Response.json({
    status,
    confirmed: !!confirmationRes.data?.confirmed_at,
    confirmed_at: confirmationRes.data?.confirmed_at ?? null,
    team_members: teamMembers,
  });
}

// ── POST /api/knowledge-profile/confirm ──────────────────────────────────────
// Applies role corrections (if any) and marks the profile as confirmed,
// promoting the knowledge_profiles row from pending_review → ready.

export async function POST(request: NextRequest) {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId?: string; corrections?: Record<string, string> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspaceId, corrections = {} } = body;
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

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
  const { error } = await db.rpc("confirm_profile", {
    p_workspace_id: workspaceId,
    p_user_id: user.id,
    p_corrections: corrections,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

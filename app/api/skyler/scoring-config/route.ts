import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  DEFAULT_SCORING_DIMENSIONS,
  DEFAULT_SCORING_THRESHOLDS,
} from "@/lib/skyler/lead-scoring";

async function resolveWorkspaceId(
  req: NextRequest,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  source: "query" | "body",
  body?: Record<string, unknown>
): Promise<string | null> {
  const fromParam =
    source === "query"
      ? req.nextUrl.searchParams.get("workspaceId")
      : (body?.workspaceId as string | undefined) ?? null;
  if (fromParam) return fromParam;

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return membership?.workspace_id ?? null;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveWorkspaceId(req, supabase, user.id, "query");
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const adminDb = createAdminSupabaseClient();
  const { data: workspace } = await adminDb
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    dimensions:
      (settings.skyler_scoring_dimensions as typeof DEFAULT_SCORING_DIMENSIONS) ??
      DEFAULT_SCORING_DIMENSIONS,
    thresholds:
      (settings.skyler_scoring_thresholds as typeof DEFAULT_SCORING_THRESHOLDS) ??
      DEFAULT_SCORING_THRESHOLDS,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { dimensions, thresholds } = body;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveWorkspaceId(req, supabase, user.id, "body", body);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const adminDb = createAdminSupabaseClient();
  const { data: workspace } = await adminDb
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const currentSettings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const newSettings = { ...currentSettings };

  if (dimensions !== undefined) newSettings.skyler_scoring_dimensions = dimensions;
  if (thresholds !== undefined) newSettings.skyler_scoring_thresholds = thresholds;

  const { error } = await adminDb
    .from("workspaces")
    .update({ settings: newSettings })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

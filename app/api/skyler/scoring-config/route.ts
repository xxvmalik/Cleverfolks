import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  DEFAULT_SCORING_DIMENSIONS,
  DEFAULT_SCORING_THRESHOLDS,
} from "@/lib/skyler/lead-scoring";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const { workspaceId, dimensions, thresholds } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();

  return NextResponse.json({ settings: ws?.settings ?? {} });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId, settings: newSettings } = await req.json();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Read current settings and deep-merge
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const current = (ws?.settings ?? {}) as Record<string, unknown>;
  const merged = { ...current };

  // Merge each top-level key from newSettings
  for (const [key, value] of Object.entries(newSettings as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      merged[key] = { ...(current[key] as Record<string, unknown> ?? {}), ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }

  await db.from("workspaces").update({ settings: merged }).eq("id", workspaceId);

  return NextResponse.json({ ok: true, settings: merged });
}

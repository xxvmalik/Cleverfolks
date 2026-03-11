import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { integrationId?: string };
  try {
    body = await request.json() as { integrationId?: string };
  } catch (e) {
    return NextResponse.json({ error: "Invalid JSON body", detail: String(e) }, { status: 400 });
  }

  const { integrationId } = body;
  if (!integrationId) {
    return NextResponse.json({ error: "integrationId is required" }, { status: 400 });
  }

  // ── Load integration + verify workspace membership ───────────────────────
  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("id, workspace_id, provider, nango_connection_id")
    .eq("id", integrationId)
    .single();

  if (integrationError || !integration) {
    return NextResponse.json(
      { error: "Integration not found", detail: integrationError?.message },
      { status: 404 }
    );
  }

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", integration.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!integration.nango_connection_id) {
    return NextResponse.json(
      { error: "Integration has no nango_connection_id — reconnect first" },
      { status: 400 }
    );
  }

  // ── Mark as syncing immediately ──────────────────────────────────────────
  await supabase
    .from("integrations")
    .update({ status: "syncing", sync_status: "syncing", sync_error: null })
    .eq("id", integrationId);

  // ── Fire Inngest background job — returns instantly ──────────────────────
  await inngest.send({
    name: "integration/sync.requested",
    data: {
      workspaceId:  integration.workspace_id,
      integrationId,
      provider:     integration.provider,
      connectionId: integration.nango_connection_id,
      windowKey:    String(Math.floor(Date.now() / (15 * 60 * 1000))),
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Sync started in background",
  });
}

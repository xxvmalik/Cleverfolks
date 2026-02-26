import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.NANGO_WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      connection_id: string;
      provider_config_key: string;
      sync_name: string;
    };

    const { connection_id, provider_config_key } = body;
    console.log(`[webhook] provider=${provider_config_key} connection=${connection_id}`);

    const supabase = createAdminSupabaseClient();
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id")
      .eq("nango_connection_id", connection_id)
      .single();

    if (integrationError || !integration) {
      console.error("[webhook] Integration not found:", integrationError);
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    // Mark as syncing and fire Inngest background job
    await supabase
      .from("integrations")
      .update({ sync_status: "syncing" })
      .eq("id", integration.id);

    await inngest.send({
      name: "integration/sync.requested",
      data: {
        workspaceId: integration.workspace_id,
        integrationId: integration.id,
        provider: provider_config_key,
        connectionId: connection_id,
      },
    });

    console.log(`[webhook] Inngest sync job fired for integration=${integration.id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

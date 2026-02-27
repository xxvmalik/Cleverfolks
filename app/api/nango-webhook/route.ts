import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      connectionId?: string;
      providerConfigKey?: string;
      syncName?: string;
      from?: string;
      model?: string;
      type?: string;
      syncType?: string;
      success?: boolean;
    };

    // Verify this is a genuine Nango webhook: body must include from="nango"
    if (body.from !== "nango") {
      console.warn("[webhook] Rejected: missing from=nango in body");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Optionally enforce shared secret if NANGO_WEBHOOK_SECRET is configured
    const secret = process.env.NANGO_WEBHOOK_SECRET;
    if (secret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${secret}`) {
        console.warn("[webhook] Rejected: invalid NANGO_WEBHOOK_SECRET");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { connectionId, providerConfigKey } = body;

    if (!connectionId) {
      return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
    }

    console.log(`[webhook] provider=${providerConfigKey} connection=${connectionId}`);

    const supabase = createAdminSupabaseClient();
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id")
      .eq("nango_connection_id", connectionId)
      .single();

    if (integrationError || !integration) {
      console.error("[webhook] Integration not found for connectionId:", connectionId, integrationError);
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
        provider: providerConfigKey ?? "",
        connectionId,
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

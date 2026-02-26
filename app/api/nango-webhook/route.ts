import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  processSyncedData,
  normalizeGmail,
  normalizeSlack,
  normalizeSlackReply,
  normalizeSlackChannel,
  normalizeSlackUser,
  normalizeCalendar,
  normalizeHubspot,
  normalizeDrive,
  type SyncRecord,
} from "@/lib/sync-processor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(provider: string, model: string, raw: any): SyncRecord | null {
  if (provider === "slack") {
    switch (model) {
      case "SlackMessage":      return normalizeSlack(raw);
      case "SlackMessageReply": return normalizeSlackReply(raw);
      case "SlackChannel":      return normalizeSlackChannel(raw);
      case "SlackUser":         return normalizeSlackUser(raw);
      default:                  return null;
    }
  }
  switch (provider) {
    case "gmail":            return normalizeGmail(raw);
    case "google-calendar":  return normalizeCalendar(raw);
    case "hubspot":          return normalizeHubspot(raw);
    case "google-drive":     return normalizeDrive(raw);
    default:                 return null;
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.NANGO_WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      connection_id: string;
      provider_config_key: string;
      sync_name: string; // this IS the model name Nango synced
    };

    const { connection_id, provider_config_key, sync_name } = body;
    console.log(`[webhook] provider=${provider_config_key} model=${sync_name} connection=${connection_id}`);

    const supabase = await createServerSupabaseClient();
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id")
      .eq("nango_connection_id", connection_id)
      .single();

    if (integrationError || !integration) {
      console.error("[webhook] Integration not found:", integrationError);
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    const rawRecords: Record<string, unknown>[] = [];
    let cursor: string | undefined = undefined;

    // Use sync_name (the model Nango just synced) — not a hardcoded map
    for (;;) {
      const page: { records: Record<string, unknown>[]; next_cursor: string | null } =
        await nango.listRecords({
          providerConfigKey: provider_config_key,
          connectionId: connection_id,
          model: sync_name,
          cursor,
        });
      rawRecords.push(...page.records);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }

    console.log(`[webhook] Fetched ${rawRecords.length} records for model=${sync_name}`);

    const records: SyncRecord[] = rawRecords
      .map((raw) => normalizeRecord(provider_config_key, sync_name, raw))
      .filter((r): r is SyncRecord => r !== null);

    console.log(`[webhook] Normalised ${records.length} records`);

    const { processed, skipped } = await processSyncedData(
      integration.workspace_id,
      integration.id,
      records
    );

    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integration.id);

    return NextResponse.json({ ok: true, processed, skipped });
  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

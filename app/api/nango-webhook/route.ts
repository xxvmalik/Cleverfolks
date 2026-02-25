import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  processSyncedData,
  normalizeGmail,
  normalizeSlack,
  normalizeCalendar,
  normalizeHubspot,
  normalizeDrive,
  type SyncRecord,
} from "@/lib/sync-processor";

const PROVIDER_MODEL_MAP: Record<string, string> = {
  gmail: "GmailEmail",
  slack: "SlackMessage",
  "google-calendar": "GoogleCalendarEvent",
  hubspot: "HubSpotDeal",
  "google-drive": "GoogleDriveFile",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(provider: string, raw: any): SyncRecord | null {
  switch (provider) {
    case "gmail":           return normalizeGmail(raw);
    case "slack":           return normalizeSlack(raw);
    case "google-calendar": return normalizeCalendar(raw);
    case "hubspot":         return normalizeHubspot(raw);
    case "google-drive":    return normalizeDrive(raw);
    default:                return null;
  }
}

export async function POST(request: NextRequest) {
  // Verify secret
  const authHeader = request.headers.get("authorization");
  const expectedSecret = `Bearer ${process.env.NANGO_WEBHOOK_SECRET}`;

  if (authHeader !== expectedSecret) {
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

    // Look up integration
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

    const model = PROVIDER_MODEL_MAP[provider_config_key] ?? "default";
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // Fetch all records (paginated)
    const rawRecords: Record<string, unknown>[] = [];
    let cursor: string | undefined = undefined;

    for (;;) {
      const page: { records: Record<string, unknown>[]; next_cursor: string | null } =
        await nango.listRecords({ providerConfigKey: provider_config_key, connectionId: connection_id, model, cursor });
      rawRecords.push(...page.records);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }

    console.log(`[webhook] Fetched ${rawRecords.length} raw records`);

    const records: SyncRecord[] = rawRecords
      .map((raw) => normalizeRecord(provider_config_key, raw))
      .filter((r): r is SyncRecord => r !== null);

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
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

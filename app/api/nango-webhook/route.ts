import { NextRequest, NextResponse } from "next/server";
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
    case "gmail":
      return normalizeGmail(raw);
    case "slack":
      return normalizeSlack(raw);
    case "google-calendar":
      return normalizeCalendar(raw);
    case "hubspot":
      return normalizeHubspot(raw);
    case "google-drive":
      return normalizeDrive(raw);
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  // 1. Verify secret
  const authHeader = request.headers.get("authorization");
  const expectedSecret = `Bearer ${process.env.NANGO_WEBHOOK_SECRET}`;

  if (authHeader !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Parse body
    const body = (await request.json()) as {
      connection_id: string;
      provider_config_key: string;
      sync_name: string;
    };

    const { connection_id, provider_config_key } = body;

    // 3. Look up integration
    const supabase = await createServerSupabaseClient();
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id")
      .eq("nango_connection_id", connection_id)
      .single();

    if (integrationError || !integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // 4. Fetch records from Nango
    const model = PROVIDER_MODEL_MAP[provider_config_key] ?? "default";
    const nangoBaseUrl = process.env.NEXT_PUBLIC_NANGO_BASE_URL;
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;

    const nangoResponse = await fetch(
      `${nangoBaseUrl}/sync/records?model=${model}&connection_id=${connection_id}`,
      {
        headers: {
          Authorization: `Bearer ${nangoSecretKey}`,
          "Provider-Config-Key": provider_config_key,
        },
      }
    );

    if (!nangoResponse.ok) {
      console.error(`Nango fetch failed: ${nangoResponse.status}`);
      return NextResponse.json(
        { error: "Failed to fetch records from Nango" },
        { status: 502 }
      );
    }

    const nangoData = (await nangoResponse.json()) as {
      records?: unknown[];
    };
    const rawRecords = nangoData.records ?? [];

    // 5. Normalize records
    const records: SyncRecord[] = rawRecords
      .map((raw) => normalizeRecord(provider_config_key, raw))
      .filter((r): r is SyncRecord => r !== null);

    // 6. Process
    const { processed, skipped } = await processSyncedData(
      integration.workspace_id,
      integration.id,
      records
    );

    // 7. Update last_synced_at + status
    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integration.id);

    return NextResponse.json({ ok: true, processed, skipped });
  } catch (err) {
    console.error("Nango webhook error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

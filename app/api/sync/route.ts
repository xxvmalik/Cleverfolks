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
  const supabase = await createServerSupabaseClient();

  // 1. Auth check
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Parse body
    const body = (await request.json()) as { integrationId: string };
    const { integrationId } = body;

    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId is required" },
        { status: 400 }
      );
    }

    // 3. Fetch integration + verify user is a workspace member
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id, provider, nango_connection_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4. Update status to syncing
    await supabase
      .from("integrations")
      .update({ status: "syncing" })
      .eq("id", integrationId);

    // 5. Fetch from Nango
    const provider: string = integration.provider;
    const connectionId: string = integration.nango_connection_id;
    const model = PROVIDER_MODEL_MAP[provider] ?? "default";
    const nangoBaseUrl = process.env.NEXT_PUBLIC_NANGO_BASE_URL;
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;

    const nangoResponse = await fetch(
      `${nangoBaseUrl}/sync/records?model=${model}&connection_id=${connectionId}`,
      {
        headers: {
          Authorization: `Bearer ${nangoSecretKey}`,
          "Provider-Config-Key": provider,
        },
      }
    );

    if (!nangoResponse.ok) {
      await supabase
        .from("integrations")
        .update({ status: "error" })
        .eq("id", integrationId);

      return NextResponse.json(
        { error: "Failed to fetch records from Nango" },
        { status: 502 }
      );
    }

    const nangoData = (await nangoResponse.json()) as { records?: unknown[] };
    const rawRecords = nangoData.records ?? [];

    // 6. Normalize + process
    const records: SyncRecord[] = rawRecords
      .map((raw) => normalizeRecord(provider, raw))
      .filter((r): r is SyncRecord => r !== null);

    const { processed, skipped } = await processSyncedData(
      integration.workspace_id,
      integrationId,
      records
    );

    // 7. Update last_synced_at + status
    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integrationId);

    return NextResponse.json({ ok: true, processed, skipped });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

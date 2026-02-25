import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  processSyncedData,
  normalizeGmail,
  normalizeSlack,
  normalizeSlackChannel,
  normalizeSlackUser,
  normalizeCalendar,
  normalizeHubspot,
  normalizeDrive,
  type SyncRecord,
} from "@/lib/sync-processor";

// All models to fetch per provider — Slack has three
const PROVIDER_MODELS_MAP: Record<string, string[]> = {
  gmail:            ["GmailEmail"],
  slack:            ["SlackMessage", "SlackChannel", "SlackUser"],
  "google-calendar":["GoogleCalendarEvent"],
  hubspot:          ["HubSpotDeal"],
  "google-drive":   ["GoogleDriveFile"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(provider: string, model: string, raw: any): SyncRecord | null {
  if (provider === "slack") {
    switch (model) {
      case "SlackMessage": return normalizeSlack(raw);
      case "SlackChannel": return normalizeSlackChannel(raw);
      case "SlackUser":    return normalizeSlackUser(raw);
      default:             return null;
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

/** Fetch every page for a single (provider, model, connectionId) triple */
async function fetchAllRecords(
  nango: Nango,
  providerConfigKey: string,
  connectionId: string,
  model: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let cursor: string | undefined = undefined;

  for (;;) {
    const page: { records: Record<string, unknown>[]; next_cursor: string | null } =
      await nango.listRecords({ providerConfigKey, connectionId, model, cursor });

    console.log(`[sync] model=${model} page: ${page.records.length} record(s) (cursor=${cursor ?? "start"})`);

    // Log the first record's shape so we can see what Nango actually returns
    if (page.records.length > 0 && !cursor) {
      console.log(`[sync] model=${model} first record sample:`, JSON.stringify(page.records[0], null, 2));
    }

    all.push(...page.records);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return all;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // ── Step 0: Auth ────────────────────────────────────────────────────────
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let integrationId = "";

  try {
    // ── Step 1: Parse + validate body ────────────────────────────────────
    let body: { integrationId?: string };
    try {
      body = await request.json() as { integrationId?: string };
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON body", detail: String(e) }, { status: 400 });
    }

    integrationId = body.integrationId ?? "";
    if (!integrationId) {
      return NextResponse.json({ error: "integrationId is required" }, { status: 400 });
    }

    // ── Step 2: Load integration + verify membership ─────────────────────
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id, workspace_id, provider, nango_connection_id")
      .eq("id", integrationId)
      .single();

    if (integrationError) {
      console.error("[sync] Integration lookup error:", integrationError);
      return NextResponse.json(
        { error: "Integration lookup failed", detail: integrationError.message },
        { status: 404 }
      );
    }
    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
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

    const provider: string = integration.provider;
    const connectionId: string = integration.nango_connection_id ?? "";
    const models = PROVIDER_MODELS_MAP[provider];

    if (!models) {
      return NextResponse.json(
        { error: `No sync models configured for provider: ${provider}` },
        { status: 400 }
      );
    }

    if (!connectionId) {
      return NextResponse.json(
        { error: "Integration has no nango_connection_id — reconnect first" },
        { status: 400 }
      );
    }

    // ── Step 3: Mark as syncing ──────────────────────────────────────────
    await supabase
      .from("integrations")
      .update({ status: "syncing" })
      .eq("id", integrationId);

    // ── Step 4: Fetch all models from Nango ──────────────────────────────
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    const allRawRecords: Array<{ model: string; raw: Record<string, unknown> }> = [];

    console.log(`[sync] provider=${provider} models=${models.join(",")} connectionId=${connectionId}`);

    for (const model of models) {
      try {
        const rawRecords = await fetchAllRecords(nango, provider, connectionId, model);
        console.log(`[sync] model=${model} total: ${rawRecords.length}`);
        for (const raw of rawRecords) {
          allRawRecords.push({ model, raw });
        }
      } catch (nangoErr) {
        console.error(`[sync] Nango listRecords failed for model=${model}:`, nangoErr);
        await supabase.from("integrations").update({ status: "error" }).eq("id", integrationId);
        return NextResponse.json(
          {
            error: `Failed to fetch records from Nango (model: ${model})`,
            detail: nangoErr instanceof Error ? nangoErr.message : String(nangoErr),
            step: "nango_fetch",
            model,
          },
          { status: 502 }
        );
      }
    }

    console.log(`[sync] Grand total raw records across all models: ${allRawRecords.length}`);

    // ── Step 5: Normalize ────────────────────────────────────────────────
    let records: SyncRecord[];
    try {
      records = allRawRecords
        .map(({ model, raw }) => normalizeRecord(provider, model, raw))
        .filter((r): r is SyncRecord => r !== null);
      console.log(`[sync] Normalized ${records.length} records (from ${allRawRecords.length} raw)`);
    } catch (normalizeErr) {
      console.error("[sync] Normalization failed:", normalizeErr);
      await supabase.from("integrations").update({ status: "error" }).eq("id", integrationId);
      return NextResponse.json(
        {
          error: "Failed to normalize records",
          detail: normalizeErr instanceof Error ? normalizeErr.message : String(normalizeErr),
          step: "normalize",
        },
        { status: 500 }
      );
    }

    // ── Step 6: Process (upsert docs, chunk, embed, store) ───────────────
    let processed = 0;
    let skipped = 0;
    try {
      const result = await processSyncedData(integration.workspace_id, integrationId, records);
      processed = result.processed;
      skipped = result.skipped;
    } catch (processErr) {
      console.error("[sync] processSyncedData threw:", processErr);
      await supabase.from("integrations").update({ status: "error" }).eq("id", integrationId);
      return NextResponse.json(
        {
          error: "Failed to process records",
          detail: processErr instanceof Error ? processErr.message : String(processErr),
          step: "process",
        },
        { status: 500 }
      );
    }

    // ── Step 7: Mark connected ───────────────────────────────────────────
    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integrationId);

    console.log(`[sync] Done — processed=${processed} skipped=${skipped}`);
    return NextResponse.json({ ok: true, processed, skipped });

  } catch (err) {
    console.error("[sync] Unhandled error:", err);
    if (integrationId) {
      try { await supabase.from("integrations").update({ status: "error" }).eq("id", integrationId); } catch { /* best-effort */ }
    }
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5).join("\n") : undefined,
      },
      { status: 500 }
    );
  }
}

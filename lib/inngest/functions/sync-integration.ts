import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  processSyncedData,
  normalizeGmail,
  normalizeSlack,
  normalizeSlackReply,
  normalizeSlackReaction,
  normalizeSlackChannel,
  normalizeSlackUser,
  normalizeCalendar,
  normalizeHubspot,
  normalizeDrive,
  type SyncRecord,
} from "@/lib/sync-processor";

// All Nango models to fetch per provider
const PROVIDER_MODELS_MAP: Record<string, string[]> = {
  gmail:             ["GmailEmail"],
  slack:             ["SlackMessage", "SlackMessageReply", "SlackMessageReaction", "SlackChannel", "SlackUser"],
  "google-calendar": ["GoogleCalendarEvent"],
  hubspot:           ["HubSpotDeal"],
  "google-drive":    ["GoogleDriveFile"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(provider: string, model: string, raw: any): SyncRecord | null {
  if (provider === "slack") {
    switch (model) {
      case "SlackMessage":         return normalizeSlack(raw);
      case "SlackMessageReply":    return normalizeSlackReply(raw);
      case "SlackMessageReaction": return normalizeSlackReaction(raw);
      case "SlackChannel":         return normalizeSlackChannel(raw);
      case "SlackUser":            return normalizeSlackUser(raw);
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

// ── Serialisable SyncRecord (no Buffer — files are handled separately) ──────
// Buffer is not JSON-serialisable so we strip the `file` field here; file-
// based records (Drive attachments) would need a separate approach.
type SerialisableSyncRecord = Omit<SyncRecord, "file">;

const BATCH_SIZE = 50;

export const syncIntegrationFunction = inngest.createFunction(
  {
    id: "sync-integration",
    name: "Sync Integration",
    retries: 2,
  },
  { event: "integration/sync.requested" },
  async ({ event, step }) => {
    const { workspaceId, integrationId, provider, connectionId } = event.data as {
      workspaceId: string;
      integrationId: string;
      provider: string;
      connectionId: string;
    };

    console.log(`[inngest] sync-integration started — provider=${provider} integrationId=${integrationId}`);

    try {
      // ── Step 1: Fetch + normalise all records from Nango ────────────────
      const records: SerialisableSyncRecord[] = await step.run(
        "fetch-nango-records",
        async () => {
          const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
          const models = PROVIDER_MODELS_MAP[provider] ?? [];
          const normalised: SerialisableSyncRecord[] = [];

          for (const model of models) {
            let cursor: string | undefined = undefined;
            let pageNum = 0;
            let modelCount = 0;

            for (;;) {
              const page: {
                records: Record<string, unknown>[];
                next_cursor: string | null;
              } = await nango.listRecords({
                providerConfigKey: provider,
                connectionId,
                model,
                cursor,
              });

              // Log first record of each model so we can inspect the shape
              if (pageNum === 0 && page.records.length > 0) {
                console.log(
                  `[inngest] model=${model} first record:`,
                  JSON.stringify(page.records[0], null, 2)
                );
              }

              for (const raw of page.records) {
                const rec = normalizeRecord(provider, model, raw);
                if (rec) {
                  // Drop non-serialisable `file` field
                  const { file: _file, ...serialisable } = rec;
                  normalised.push(serialisable);
                }
              }

              modelCount += page.records.length;
              if (!page.next_cursor) break;
              cursor = page.next_cursor;
              pageNum++;
            }

            console.log(`[inngest] model=${model}: fetched ${modelCount} raw → ${normalised.length} total normalised so far`);
          }

          return normalised;
        }
      );

      console.log(`[inngest] Total records to process: ${records.length}`);

      // ── Step 2: Process in batches of BATCH_SIZE ────────────────────────
      const totalBatches = Math.ceil(records.length / BATCH_SIZE);
      let totalProcessed = 0;
      let totalSkipped = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = records.slice(i, i + BATCH_SIZE) as SyncRecord[];

        const result = await step.run(`process-batch-${batchNum}`, async () => {
          console.log(
            `[inngest] Processing batch ${batchNum}/${totalBatches} ` +
            `(${batch.length} records) for workspace ${workspaceId}`
          );
          const supabase = createAdminSupabaseClient();
          return processSyncedData(workspaceId, integrationId, batch, supabase);
        });

        totalProcessed += result.processed;
        totalSkipped += result.skipped;

        console.log(
          `[inngest] Batch ${batchNum}/${totalBatches} done — ` +
          `batch processed=${result.processed} skipped=${result.skipped} | ` +
          `running total=${totalProcessed}`
        );
      }

      // ── Step 3: Mark complete ────────────────────────────────────────────
      await step.run("finalize", async () => {
        const supabase = createAdminSupabaseClient();
        await supabase
          .from("integrations")
          .update({
            status: "connected",
            sync_status: "completed",
            last_synced_at: new Date().toISOString(),
            synced_count: totalProcessed,
            sync_error: null,
          })
          .eq("id", integrationId);
      });

      console.log(`[inngest] sync-integration complete — processed=${totalProcessed} skipped=${totalSkipped}`);
      return { processed: totalProcessed, skipped: totalSkipped };

    } catch (err) {
      console.error("[inngest] sync-integration failed:", err);
      // Best-effort error status update (direct call, not a step, so it runs even on retry)
      try {
        const supabase = createAdminSupabaseClient();
        await supabase
          .from("integrations")
          .update({
            sync_status: "error",
            sync_error: err instanceof Error ? err.message : String(err),
          })
          .eq("id", integrationId);
      } catch (dbErr) {
        console.error("[inngest] Failed to update error status:", dbErr);
      }
      throw err; // re-throw so Inngest records the failure and can retry
    }
  }
);

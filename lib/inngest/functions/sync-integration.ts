import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { buildUserMap } from "@/lib/slack-user-resolver";
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
  type SlackLookups,
} from "@/lib/sync-processor";

// All Nango models to fetch per provider
const PROVIDER_MODELS_MAP: Record<string, string[]> = {
  gmail:             ["GmailEmail"],
  // SlackUser + SlackChannel are fetched first (in buildSlackLookups step) to
  // build lookup maps, then fetched again here to store as searchable documents.
  slack:             ["SlackMessage", "SlackMessageReply", "SlackMessageReaction", "SlackChannel", "SlackUser"],
  "google-calendar": ["GoogleCalendarEvent"],
  hubspot:           ["HubSpotDeal"],
  "google-drive":    ["GoogleDriveFile"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(provider: string, model: string, raw: any, lookups?: SlackLookups): SyncRecord | null {
  if (provider === "slack") {
    switch (model) {
      case "SlackMessage":         return normalizeSlack(raw, lookups);
      case "SlackMessageReply":    return normalizeSlackReply(raw, lookups);
      case "SlackMessageReaction": return normalizeSlackReaction(raw, lookups);
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

/** Fetch SlackUser + SlackChannel records from Nango and build lookup maps.
 *  Uses buildUserMap for correct name priority (real_name first) and bot exclusion.
 *  Returns plain objects (JSON-serialisable for Inngest step boundaries). */
async function fetchSlackLookups(
  nango: Nango,
  connectionId: string
): Promise<{ users: Record<string, string>; channels: Record<string, string> }> {
  const userRecords: Record<string, unknown>[] = [];
  const channels: Record<string, string> = {};

  for (const model of ["SlackUser", "SlackChannel"]) {
    let cursor: string | undefined;
    for (;;) {
      const page: { records: Record<string, unknown>[]; next_cursor: string | null } =
        await nango.listRecords({ providerConfigKey: "slack", connectionId, model, cursor });

      for (const raw of page.records) {
        if (model === "SlackUser") {
          userRecords.push(raw);
        } else if (model === "SlackChannel" && raw.id) {
          channels[raw.id as string] = (raw.name as string | undefined) ?? (raw.id as string);
        }
      }

      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
  }

  // buildUserMap: real_name → display_name → handle, skips bots/deleted
  const users = buildUserMap(userRecords);
  console.log(`[inngest] Slack lookups built — ${Object.keys(users).length} users, ${Object.keys(channels).length} channels`);
  return { users, channels };
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
      // ── Step 1a (Slack only): pre-fetch users + channels for ID resolution ──
      // Plain-object maps that survive Inngest's JSON step boundary.
      const slackLookups: { users: Record<string, string>; channels: Record<string, string> } | null =
        provider === "slack"
          ? await step.run("build-slack-lookups", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              return fetchSlackLookups(nango, connectionId);
            })
          : null;

      // ── Step 1b: Fetch + normalise all records from Nango ───────────────
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
                const rec = normalizeRecord(provider, model, raw, slackLookups ?? undefined);
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

      // ── Step 4: Trigger knowledge profile rebuild ─────────────────────────
      // Fires after every successful sync so CleverBrain's company intelligence
      // stays current with the latest data.
      await step.sendEvent("trigger-knowledge-profile-build", {
        name: "knowledge/profile.build",
        data: { workspaceId },
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

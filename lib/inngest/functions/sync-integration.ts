import { Nango } from "@nangohq/node";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { buildUserMap } from "@/lib/slack-user-resolver";
import { scoreAllContacts } from "@/lib/skyler/lead-scoring";
import {
  processSyncedData,
  normalizeGmail,
  normalizeGmailContact,
  buildGmailContactMap,
  normalizeSlack,
  normalizeSlackReply,
  normalizeSlackReaction,
  normalizeSlackChannel,
  normalizeSlackUser,
  normalizeCalendar,
  normalizeHubspot,
  normalizeHubspotContact,
  normalizeHubspotCompany,
  normalizeHubspotDeal,
  normalizeHubspotTicket,
  normalizeHubspotTask,
  normalizeHubspotNote,
  normalizeHubspotOwner,
  normalizeHubspotProduct,
  normalizeHubspotUser,
  normalizeHubspotKbArticle,
  normalizeHubspotServiceTicket,
  normalizeHubspotCurrency,
  normalizeOutlookEmail,
  normalizeOutlookEvent,
  normalizeOutlookContact,
  normalizeDrive,
  type SyncRecord,
  type SlackLookups,
} from "@/lib/sync-processor";

// ── Gmail transactional email filter ─────────────────────────────────────────
// Add entries here to suppress additional noise sources without touching logic.

/** Email address prefixes that indicate automated/no-reply senders. */
const GMAIL_BLOCKED_SENDER_PREFIXES = [
  "noreply@",
  "no-reply@",
  "notifications@",
  "receipts@",
  "alerts@",
  "mailer-daemon@",
  "donotreply@",
  "do-not-reply@",
  "bounce@",
];

/** Subject line substrings (case-insensitive) that flag transactional email. */
const GMAIL_BLOCKED_SUBJECT_PATTERNS = [
  "payment receipt",
  "payment confirmation",
  "payment successful",
  "payment failed",
  "transaction receipt",
  "transaction confirmation",
  "order confirmation",
  "order receipt",
  "invoice",
  "your receipt",
  "purchase confirmation",
  "subscription renewal",
  "auto-debit",
];

/**
 * Returns true when a gmail_message should be skipped as automated /
 * transactional noise.
 *
 * Both conditions must match: an automated sender prefix AND a
 * transactional subject pattern.  Either alone is not enough —
 * e.g. support@korapay.com with "Action needed" passes through, but
 * noreply@korapay.com with "Payment Receipt" is skipped.
 */
function isTransactionalEmail(metadata: Record<string, unknown>): boolean {
  const from = ((metadata.from as string | undefined) ?? "").toLowerCase();
  const subject = ((metadata.subject as string | undefined) ?? "").toLowerCase();

  const hasBlockedPrefix = GMAIL_BLOCKED_SENDER_PREFIXES.some((p) => from.includes(p));
  const hasBlockedSubject = GMAIL_BLOCKED_SUBJECT_PATTERNS.some((p) => subject.includes(p));

  return hasBlockedPrefix && hasBlockedSubject;
}

// All Nango models to fetch per provider
const PROVIDER_MODELS_MAP: Record<string, string[]> = {
  // GmailContact fetched first so the contact map is ready when normalising GmailEmail
  "google-mail":     ["GmailEmail", "GmailContact"],
  // SlackUser + SlackChannel are fetched first (in buildSlackLookups step) to
  // build lookup maps, then fetched again here to store as searchable documents.
  slack:             ["SlackMessage", "SlackMessageReply", "SlackMessageReaction", "SlackChannel", "SlackUser"],
  "google-calendar": ["GoogleCalendarEvent"],
  hubspot:           ["Company", "Contact", "CurrencyCode", "Deal", "HubspotKnowledgeBaseArticle", "HubspotOwner", "HubspotServiceTicket", "Note", "Product", "Task", "Ticket", "User"],
  "google-drive":    ["GoogleDriveFile"],
  outlook:           ["OutlookEmail", "OutlookCalendarEvent", "OutlookContact"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(
  provider: string,
  model: string,
  raw: any,
  lookups?: SlackLookups,
  gmailContacts?: Record<string, string>,
  hubspotStageMap?: Record<string, string>,
  hubspotOwnerMap?: Record<string, string>,
  hubspotContactCompanyMap?: Record<string, string>,
  hubspotContactDealMap?: Record<string, string[]>,
): SyncRecord | null {
  if (provider === "slack") {
    switch (model) {
      case "SlackMessage":         return normalizeSlack(raw, lookups);
      case "SlackMessageReply":    return normalizeSlackReply(raw, lookups);
      case "SlackMessageReaction": return normalizeSlackReaction(raw, lookups);
      case "SlackChannel":         return normalizeSlackChannel(raw);
      case "SlackUser":            return normalizeSlackUser(raw);
      default:                     return null;
    }
  }
  if (provider === "google-mail") {
    switch (model) {
      case "GmailEmail":   return normalizeGmail(raw, gmailContacts);
      case "GmailContact": return normalizeGmailContact(raw);
      default:             return null;
    }
  }
  if (provider === "outlook") {
    switch (model) {
      case "OutlookEmail":          return normalizeOutlookEmail(raw);
      case "OutlookCalendarEvent":  return normalizeOutlookEvent(raw);
      case "OutlookContact":        return normalizeOutlookContact(raw);
      default:                      return null;
    }
  }
  if (provider === "hubspot") {
    switch (model) {
      case "Deal":                        return normalizeHubspotDeal(raw, hubspotStageMap, hubspotOwnerMap, hubspotContactCompanyMap);
      case "Contact": {
        const contactId = raw.id as string | undefined;
        const enrichment = contactId ? {
          companyName: hubspotContactCompanyMap?.[contactId],
          dealNames: hubspotContactDealMap?.[contactId],
        } : undefined;
        return normalizeHubspotContact(raw, enrichment);
      }
      case "Company":                     return normalizeHubspotCompany(raw);
      case "Task":                        return normalizeHubspotTask(raw, hubspotOwnerMap);
      case "Ticket":                      return normalizeHubspotTicket(raw, hubspotOwnerMap);
      case "Note":                        return normalizeHubspotNote(raw, hubspotOwnerMap);
      case "HubspotOwner":                return normalizeHubspotOwner(raw);
      case "Product":                     return normalizeHubspotProduct(raw);
      case "User":                        return normalizeHubspotUser(raw);
      case "HubspotKnowledgeBaseArticle": return normalizeHubspotKbArticle(raw);
      case "HubspotServiceTicket":         return normalizeHubspotServiceTicket(raw, hubspotOwnerMap);
      case "CurrencyCode":               return normalizeHubspotCurrency(raw);
      default:                            return null;
    }
  }
  switch (provider) {
    case "google-calendar":  return normalizeCalendar(raw);
    case "google-drive":     return normalizeDrive(raw);
    default:                 return null;
  }
}

/** Fetch GmailContact records from Nango and build an email → display name map.
 *  Degrades gracefully if the GmailContact model is not configured in Nango. */
async function fetchGmailContacts(
  nango: Nango,
  connectionId: string
): Promise<Record<string, string>> {
  const contacts: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  try {
    for (;;) {
      const page: { records: Record<string, unknown>[]; next_cursor: string | null } =
        await nango.listRecords({
          providerConfigKey: "google-mail",
          connectionId,
          model: "GmailContact",
          cursor,
        });
      contacts.push(...page.records);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
  } catch (err) {
    console.warn(
      "[inngest] GmailContact fetch failed (model may not be configured in Nango):",
      err instanceof Error ? err.message : String(err)
    );
    return {};
  }

  const map = buildGmailContactMap(contacts);
  console.log(`[inngest] Gmail contact map built — ${Object.keys(map).length} contacts`);
  return map;
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
    // Dedup: only one sync per connection per 2-hour window
    idempotency: "event.data.connectionId + '-' + event.data.windowKey",
  },
  { event: "integration/sync.requested" },
  async ({ event, step }) => {
    const { workspaceId, integrationId, provider, connectionId } = event.data as {
      workspaceId: string;
      integrationId: string;
      provider: string;
      connectionId: string;
      windowKey?: string;
    };

    console.log(`[inngest] sync-integration started — provider=${provider} integrationId=${integrationId} connectionId=${connectionId}`);

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

      // ── Step 1b (Gmail only): pre-fetch contacts for sender name resolution ──
      const gmailContactMap: Record<string, string> | null =
        provider === "google-mail"
          ? await step.run("build-gmail-contacts", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              return fetchGmailContacts(nango, connectionId);
            })
          : null;

      // ── Step 1c (HubSpot only): pre-fetch pipeline stages + owner names ──
      const hubspotStageMap: Record<string, string> | null =
        provider === "hubspot"
          ? await step.run("build-hubspot-stage-map", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              try {
                const result = await nango.triggerAction("hubspot", connectionId, "fetch-pipelines", {});
                const map: Record<string, string> = {};
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const pipeline of (result as any)?.pipelines ?? []) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  for (const stage of pipeline.stages ?? []) {
                    if (stage.id && stage.label) {
                      map[stage.id] = stage.label;
                    }
                  }
                }
                console.log(`[inngest] HubSpot stage map built — ${Object.keys(map).length} stages`);
                return map;
              } catch (err) {
                console.warn("[inngest] fetch-pipelines failed, deal stages will use IDs:", err instanceof Error ? err.message : String(err));
                return {};
              }
            })
          : null;

      // ── Step 1d (HubSpot only): pre-fetch owner ID → name map ──
      const hubspotOwnerMap: Record<string, string> | null =
        provider === "hubspot"
          ? await step.run("build-hubspot-owner-map", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              const map: Record<string, string> = {};
              let cursor: string | undefined;
              try {
                for (;;) {
                  const page = await nango.listRecords({
                    providerConfigKey: "hubspot",
                    connectionId,
                    model: "HubspotOwner",
                    cursor,
                  });
                  for (const raw of page.records) {
                    const ownerId = (raw as Record<string, unknown>).id as string | undefined;
                    const first = ((raw as Record<string, unknown>).firstName as string) ?? "";
                    const last = ((raw as Record<string, unknown>).lastName as string) ?? "";
                    const name = [first, last].filter(Boolean).join(" ");
                    if (ownerId && name) map[ownerId] = name;
                  }
                  if (!page.next_cursor) break;
                  cursor = page.next_cursor;
                }
              } catch (err) {
                console.warn("[inngest] HubspotOwner fetch failed:", err instanceof Error ? err.message : String(err));
              }
              console.log(`[inngest] HubSpot owner map built — ${Object.keys(map).length} owners`);
              return map;
            })
          : null;

      // ── Step 1e (HubSpot only): build contact→company and contact→deal enrichment maps ──
      const hubspotContactCompanyMap: Record<string, string> | null =
        provider === "hubspot"
          ? await step.run("build-hubspot-contact-company-map", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              const contactToCompany: Record<string, string> = {};
              try {
                // Build companyId→name map
                const companyNames: Record<string, string> = {};
                let compCursor: string | undefined;
                for (;;) {
                  const page = await nango.listRecords({ providerConfigKey: "hubspot", connectionId, model: "Company", cursor: compCursor });
                  for (const raw of page.records) {
                    const r = raw as Record<string, unknown>;
                    if (r.id && r.name) companyNames[r.id as string] = r.name as string;
                  }
                  if (!page.next_cursor) break;
                  compCursor = page.next_cursor;
                }
                // Fetch contacts via HubSpot proxy to get associatedcompanyid
                let after: string | undefined;
                for (;;) {
                  const params = new URLSearchParams({ limit: "100", properties: "associatedcompanyid" });
                  if (after) params.set("after", after);
                  const resp = await nango.proxy({
                    method: "GET",
                    baseUrlOverride: "https://api.hubapi.com",
                    endpoint: `/crm/v3/objects/contacts?${params.toString()}`,
                    providerConfigKey: "hubspot",
                    connectionId,
                  });
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const body = resp.data as any;
                  for (const contact of body?.results ?? []) {
                    const cId = contact.id as string;
                    const assocCompId = contact.properties?.associatedcompanyid as string | undefined;
                    if (cId && assocCompId && companyNames[assocCompId]) {
                      contactToCompany[cId] = companyNames[assocCompId];
                    }
                  }
                  after = body?.paging?.next?.after as string | undefined;
                  if (!after) break;
                }
              } catch (err) {
                console.warn("[inngest] Contact→Company map failed:", err instanceof Error ? err.message : String(err));
              }
              console.log(`[inngest] Contact→Company map: ${Object.keys(contactToCompany).length} entries`);
              return contactToCompany;
            })
          : null;

      const hubspotContactDealMap: Record<string, string[]> | null =
        provider === "hubspot"
          ? await step.run("build-hubspot-contact-deal-map", async () => {
              const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
              const map: Record<string, string[]> = {};
              let cursor: string | undefined;
              try {
                for (;;) {
                  const page = await nango.listRecords({ providerConfigKey: "hubspot", connectionId, model: "Deal", cursor });
                  for (const raw of page.records) {
                    const r = raw as Record<string, unknown>;
                    const dealName = (r.name as string) ?? "Untitled Deal";
                    const assoc = r.returned_associations as { contacts?: Array<{ id?: string }> } | undefined;
                    if (assoc?.contacts?.length) {
                      for (const c of assoc.contacts) {
                        const cId = c.id as string | undefined;
                        if (cId) {
                          if (!map[cId]) map[cId] = [];
                          if (!map[cId].includes(dealName)) map[cId].push(dealName);
                        }
                      }
                    }
                  }
                  if (!page.next_cursor) break;
                  cursor = page.next_cursor;
                }
              } catch (err) {
                console.warn("[inngest] Contact→Deal map failed:", err instanceof Error ? err.message : String(err));
              }
              console.log(`[inngest] Contact→Deal map: ${Object.keys(map).length} entries`);
              return map;
            })
          : null;

      // ── Step 1f (HubSpot only): fetch account currency and save to workspace settings ──
      if (provider === "hubspot") {
        await step.run("fetch-hubspot-account-currency", async () => {
          const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
          try {
            const accountInfo = await nango.triggerAction("hubspot", connectionId, "fetch-account-information", {});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const companyCurrency = (accountInfo as any)?.companyCurrency as string | undefined;
            if (companyCurrency) {
              const supabase = createAdminSupabaseClient();
              const { data: ws } = await supabase
                .from("workspaces")
                .select("settings")
                .eq("id", workspaceId)
                .single();
              const settings = (ws?.settings ?? {}) as Record<string, unknown>;
              // Only set if no currency is configured yet (don't override manual setting)
              if (!settings.currency) {
                settings.currency = companyCurrency;
                await supabase.from("workspaces").update({ settings }).eq("id", workspaceId);
                console.log(`[inngest] Saved HubSpot account currency ${companyCurrency} to workspace settings`);
              } else {
                console.log(`[inngest] Workspace already has currency=${settings.currency}, keeping it`);
              }
            }
          } catch (err) {
            console.warn("[inngest] fetch-account-information failed:", err instanceof Error ? err.message : String(err));
          }
        });
      }

      // ── Step 1g: Fetch + normalise all records from Nango ───────────────
      const records: SerialisableSyncRecord[] = await step.run(
        "fetch-nango-records",
        async () => {
          const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
          const models = PROVIDER_MODELS_MAP[provider] ?? [];
          const normalised: SerialisableSyncRecord[] = [];

          // Date cutoff: only process emails from the last 6 months (Gmail + Outlook)
          const emailCutoff = new Date();
          emailCutoff.setMonth(emailCutoff.getMonth() - 6);
          let gmailDateSkipped = 0;
          let gmailTransactionalSkipped = 0;
          let outlookDateSkipped = 0;
          let outlookTransactionalSkipped = 0;

          // ts → resolved message text. Populated while processing SlackMessage
          // records (which come before SlackMessageReply in PROVIDER_MODELS_MAP)
          // so every reply can prepend its parent's text for context-aware search.
          const parentTextMap: Record<string, string> = {};

          for (const model of models) {
            let cursor: string | undefined = undefined;
            let pageNum = 0;
            let modelCount = 0;

            try {
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

              for (const raw of page.records) {
                // For Slack replies, augment lookups with the parent text map so
                // normalizeSlackReply can prepend "[Replying to: ...]" context.
                const lookupsForRecord =
                  provider === "slack" && slackLookups
                    ? { ...slackLookups, messages: parentTextMap }
                    : (slackLookups ?? undefined);

                const rec = normalizeRecord(
                  provider,
                  model,
                  raw,
                  lookupsForRecord,
                  gmailContactMap ?? undefined,
                  hubspotStageMap ?? undefined,
                  hubspotOwnerMap ?? undefined,
                  hubspotContactCompanyMap ?? undefined,
                  hubspotContactDealMap ?? undefined,
                );
                if (rec) {
                  if (provider === "google-mail" && rec.source_type === "gmail_message") {
                    const meta = rec.metadata ?? {};

                    // Date filter: skip emails older than 6 months
                    const tsRaw = meta.ts as string | undefined;
                    const emailDate = tsRaw ? new Date(parseFloat(tsRaw) * 1000) : null;
                    if (!emailDate || emailDate < emailCutoff) {
                      gmailDateSkipped++;
                      continue;
                    }

                    // Transactional filter: skip automated / payment noise
                    if (isTransactionalEmail(meta)) {
                      gmailTransactionalSkipped++;
                      continue;
                    }
                  }

                  // Outlook email: same 6-month date + transactional filters
                  if (provider === "outlook" && rec.source_type === "outlook_email") {
                    const meta = rec.metadata ?? {};

                    const tsRaw = meta.ts as string | undefined;
                    const emailDate = tsRaw ? new Date(parseFloat(tsRaw) * 1000) : null;
                    if (!emailDate || emailDate < emailCutoff) {
                      outlookDateSkipped++;
                      continue;
                    }

                    if (isTransactionalEmail(meta)) {
                      outlookTransactionalSkipped++;
                      continue;
                    }
                  }

                  // Drop non-serialisable `file` field
                  const { file: _file, ...serialisable } = rec;
                  normalised.push(serialisable);
                }

                // Collect parent message text AFTER normalizing so we use the
                // resolved text (real names instead of user IDs).
                if (provider === "slack" && model === "SlackMessage" && rec) {
                  const ts = (raw.ts ?? raw.id) as string | undefined;
                  if (ts && rec.content) {
                    parentTextMap[ts] = rec.content.slice(0, 300);
                  }
                }
              }

              modelCount += page.records.length;
              if (!page.next_cursor) break;
              cursor = page.next_cursor;
              pageNum++;
            }

            console.log(`[inngest] model=${model}: fetched ${modelCount} raw → ${normalised.length} total normalised so far`);
            } catch (modelErr: unknown) {
              console.error(
                `[inngest] listRecords failed for model=${model}:`,
                modelErr instanceof Error ? modelErr.message : String(modelErr)
              );
              // Continue with remaining models
            }
          }

          if (gmailDateSkipped > 0) {
            console.log(
              `[inngest] google-mail: skipped ${gmailDateSkipped} emails older than 6 months (cutoff=${emailCutoff.toISOString()})`
            );
          }
          if (gmailTransactionalSkipped > 0) {
            console.log(
              `[inngest] google-mail: skipped ${gmailTransactionalSkipped} automated/transactional emails`
            );
          }
          if (outlookDateSkipped > 0) {
            console.log(
              `[inngest] outlook: skipped ${outlookDateSkipped} emails older than 6 months (cutoff=${emailCutoff.toISOString()})`
            );
          }
          if (outlookTransactionalSkipped > 0) {
            console.log(
              `[inngest] outlook: skipped ${outlookTransactionalSkipped} automated/transactional emails`
            );
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

      // ── Step 5: Auto-score all contacts (lead qualification) ──────────────
      // Only runs for HubSpot syncs — scores contacts that haven't been scored yet
      if (provider === "hubspot") {
        await step.run("auto-score-contacts", async () => {
          const supabase = createAdminSupabaseClient();
          try {
            const scored = await scoreAllContacts(supabase, workspaceId);
            console.log(`[inngest] Auto-scored ${scored} contacts`);
          } catch (err) {
            console.warn("[inngest] Auto-scoring failed (non-fatal):", err instanceof Error ? err.message : String(err));
          }
        });
      }

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

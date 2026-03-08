import { NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { chunkText } from "@/lib/chunking";
import { createEmbeddings } from "@/lib/embeddings";
import {
  normalizeHubspotDeal,
  normalizeHubspotContact,
  normalizeHubspotCompany,
  normalizeHubspotTicket,
  normalizeHubspotTask,
  normalizeHubspotNote,
  normalizeHubspotOwner,
  normalizeHubspotProduct,
  normalizeHubspotUser,
  normalizeHubspotKbArticle,
  normalizeHubspotServiceTicket,
  normalizeHubspotCurrency,
  type SyncRecord,
} from "@/lib/sync-processor";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

type EnrichmentMaps = {
  ownerMap: Record<string, string>;
  stageMap: Record<string, string>;
  contactCompanyMap: Record<string, string>;   // contactId → company name
  contactDealMap: Record<string, string[]>;    // contactId → deal names
  companyContactMap: Record<string, string[]>; // companyId → contact IDs
};

const HUBSPOT_MODELS: Record<string, (raw: any, maps: EnrichmentMaps) => SyncRecord | null> = {
  Deal:                        (raw, maps) => normalizeHubspotDeal(raw, maps.stageMap, maps.ownerMap, maps.contactCompanyMap),
  Contact:                     (raw, maps) => {
    const contactId = raw.id as string | undefined;
    const enrichment = contactId ? {
      companyName: maps.contactCompanyMap[contactId],
      dealNames: maps.contactDealMap[contactId],
    } : undefined;
    return normalizeHubspotContact(raw, enrichment);
  },
  Company:                     (raw) => normalizeHubspotCompany(raw),
  Ticket:                      (raw, maps) => normalizeHubspotTicket(raw, maps.ownerMap),
  Task:                        (raw, maps) => normalizeHubspotTask(raw, maps.ownerMap),
  Note:                        (raw, maps) => normalizeHubspotNote(raw, maps.ownerMap),
  HubspotOwner:                (raw) => normalizeHubspotOwner(raw),
  Product:                     (raw) => normalizeHubspotProduct(raw),
  User:                        (raw) => normalizeHubspotUser(raw),
  HubspotKnowledgeBaseArticle: (raw) => normalizeHubspotKbArticle(raw),
  HubspotServiceTicket:        (raw, maps) => normalizeHubspotServiceTicket(raw, maps.ownerMap),
  CurrencyCode:                (raw) => normalizeHubspotCurrency(raw),
};

export async function POST(req: Request) {
  // Simple auth check — require admin secret
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.ADMIN_REPROCESS_SECRET && secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[reprocess] ${msg}`);
    logs.push(msg);
  };

  try {
    const supabase = createAdminSupabaseClient();
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // Find the HubSpot integration for this workspace
    const { data: integration, error: intErr } = await supabase
      .from("integrations")
      .select("id, nango_connection_id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "hubspot")
      .single();

    if (intErr || !integration) {
      return NextResponse.json({ error: "HubSpot integration not found", detail: intErr?.message }, { status: 404 });
    }

    const connectionId = integration.nango_connection_id;
    const integrationId = integration.id;
    log(`Found HubSpot integration=${integrationId} connectionId=${connectionId}`);

    // Step 1: Build owner map
    const ownerMap: Record<string, string> = {};
    let ownerCursor: string | undefined;
    for (;;) {
      const page = await nango.listRecords({
        providerConfigKey: "hubspot",
        connectionId,
        model: "HubspotOwner",
        cursor: ownerCursor,
      });
      for (const raw of page.records) {
        const r = raw as Record<string, unknown>;
        const id = r.id as string | undefined;
        const first = (r.firstName as string) ?? "";
        const last = (r.lastName as string) ?? "";
        const name = [first, last].filter(Boolean).join(" ");
        if (id && name) ownerMap[id] = name;
      }
      if (!page.next_cursor) break;
      ownerCursor = page.next_cursor;
    }
    log(`Owner map: ${Object.keys(ownerMap).length} owners`);

    // Step 2: Build stage map + fetch account currency
    const stageMap: Record<string, string> = {};
    try {
      const result = await nango.triggerAction("hubspot", connectionId, "fetch-pipelines", {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const pipeline of (result as any)?.pipelines ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const stage of pipeline.stages ?? []) {
          if (stage.id && stage.label) stageMap[stage.id] = stage.label;
        }
      }
    } catch {
      log("fetch-pipelines failed — stages will use IDs");
    }
    log(`Stage map: ${Object.keys(stageMap).length} stages`);

    // Fetch HubSpot account info to get companyCurrency and save to workspace settings
    try {
      const accountInfo = await nango.triggerAction("hubspot", connectionId, "fetch-account-information", {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const companyCurrency = (accountInfo as any)?.companyCurrency as string | undefined;
      if (companyCurrency) {
        log(`HubSpot account currency: ${companyCurrency}`);
        // Read current workspace settings, set currency if not already manually overridden
        const { data: ws } = await supabase
          .from("workspaces")
          .select("settings")
          .eq("id", WORKSPACE_ID)
          .single();
        const settings = (ws?.settings ?? {}) as Record<string, unknown>;
        // Only set if no currency is configured yet (don't override manual setting)
        if (!settings.currency) {
          settings.currency = companyCurrency;
          await supabase.from("workspaces").update({ settings }).eq("id", WORKSPACE_ID);
          log(`Saved currency ${companyCurrency} to workspace settings`);
        } else {
          log(`Workspace already has currency=${settings.currency}, keeping it`);
        }
      }
    } catch (err) {
      log(`fetch-account-information failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 3: Build enrichment maps (contact→company, contact→deals) by pre-fetching associations
    const contactCompanyMap: Record<string, string> = {};   // contactId → company name
    const contactDealMap: Record<string, string[]> = {};    // contactId → deal names
    const companyContactMap: Record<string, string[]> = {}; // companyId → contact IDs

    // 3a: Build companyId→companyName map from all companies
    const companyNameMap: Record<string, string> = {};
    {
      let cursor: string | undefined;
      for (;;) {
        const page = await nango.listRecords({ providerConfigKey: "hubspot", connectionId, model: "Company", cursor });
        for (const raw of page.records) {
          const r = raw as Record<string, unknown>;
          const compId = r.id as string | undefined;
          const compName = r.name as string | undefined;
          if (compId && compName) companyNameMap[compId] = compName;
        }
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      log(`Company name map: ${Object.keys(companyNameMap).length} companies`);
    }

    // 3b: Fetch all contacts via HubSpot proxy to get associatedcompanyid
    // (Nango Contact model does NOT expose returned_associations for companies)
    {
      let after: string | undefined;
      for (;;) {
        const params = new URLSearchParams({ limit: "100", properties: "associatedcompanyid,firstname,lastname" });
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
          const contactId = contact.id as string;
          const assocCompanyId = contact.properties?.associatedcompanyid as string | undefined;
          if (contactId && assocCompanyId && companyNameMap[assocCompanyId]) {
            contactCompanyMap[contactId] = companyNameMap[assocCompanyId];
            if (!companyContactMap[assocCompanyId]) companyContactMap[assocCompanyId] = [];
            companyContactMap[assocCompanyId].push(contactId);
          }
        }
        after = body?.paging?.next?.after as string | undefined;
        if (!after) break;
      }
      log(`Contact→Company map: ${Object.keys(contactCompanyMap).length} contacts with companies`);
    }

    // 3c: Pre-fetch all deals to build contactId→dealNames map
    {
      let cursor: string | undefined;
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
                if (!contactDealMap[cId]) contactDealMap[cId] = [];
                if (!contactDealMap[cId].includes(dealName)) contactDealMap[cId].push(dealName);
              }
            }
          }
        }
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      log(`Contact→Deal map: ${Object.keys(contactDealMap).length} contacts with deals`);
    }

    const enrichmentMaps: EnrichmentMaps = { ownerMap, stageMap, contactCompanyMap, contactDealMap, companyContactMap };

    // Step 4: Fetch all records from Nango, normalize, and update
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalChunks = 0;

    for (const [model, normalizeFn] of Object.entries(HUBSPOT_MODELS)) {
      let cursor: string | undefined;
      let modelCount = 0;

      try {
        for (;;) {
          const page = await nango.listRecords({
            providerConfigKey: "hubspot",
            connectionId,
            model,
            cursor,
          });

          for (const raw of page.records) {
            const rec = normalizeFn(raw as any, enrichmentMaps);
            if (!rec || !rec.content?.trim()) {
              totalSkipped++;
              continue;
            }

            // Upsert the synced_document with new content
            const { data: documentId, error: docErr } = await supabase.rpc(
              "upsert_synced_document",
              {
                p_workspace_id: WORKSPACE_ID,
                p_integration_id: integrationId,
                p_source_type: rec.source_type,
                p_external_id: rec.external_id,
                p_title: rec.title ?? "",
                p_content: rec.content,
                p_metadata: rec.metadata ?? {},
              }
            );

            if (docErr || !documentId) {
              log(`SKIP ${model} ${rec.external_id}: ${docErr?.message ?? "null documentId"}`);
              totalSkipped++;
              continue;
            }

            // Delete old chunks
            await supabase.rpc("delete_chunks_for_document", { p_document_id: documentId });

            // Re-chunk and re-embed
            const chunks = chunkText(rec.content, {
              source_type: rec.source_type,
              external_id: rec.external_id,
              ...(rec.metadata ?? {}),
            });

            if (chunks.length === 0) {
              totalSkipped++;
              continue;
            }

            const chunkTexts = chunks.map((c) => c.text);
            const embeddings = await createEmbeddings(chunkTexts);

            for (let j = 0; j < chunks.length; j++) {
              const embedding = embeddings[j];
              if (!embedding || embedding.length === 0) continue;

              await supabase.rpc("create_document_chunk", {
                p_document_id: documentId,
                p_workspace_id: WORKSPACE_ID,
                p_chunk_text: chunks[j].text,
                p_chunk_index: chunks[j].index,
                p_embedding: `[${embedding.join(",")}]`,
                p_metadata: chunks[j].metadata,
              });
              totalChunks++;
            }

            modelCount++;
            totalProcessed++;
          }

          if (!page.next_cursor) break;
          cursor = page.next_cursor;
        }
      } catch (err) {
        log(`ERROR on model ${model}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (modelCount > 0) {
        log(`${model}: ${modelCount} records reprocessed`);
      }
    }

    log(`Done — processed=${totalProcessed} skipped=${totalSkipped} chunks=${totalChunks}`);

    return NextResponse.json({
      success: true,
      processed: totalProcessed,
      skipped: totalSkipped,
      chunks: totalChunks,
      logs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Fatal error: ${msg}`);
    return NextResponse.json({ error: msg, logs }, { status: 500 });
  }
}

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

const HUBSPOT_MODELS: Record<string, (raw: any, ownerMap?: Record<string, string>, stageMap?: Record<string, string>) => SyncRecord | null> = {
  Deal:                        (raw, ownerMap, stageMap) => normalizeHubspotDeal(raw, stageMap, ownerMap),
  Contact:                     (raw) => normalizeHubspotContact(raw),
  Company:                     (raw) => normalizeHubspotCompany(raw),
  Ticket:                      (raw, ownerMap) => normalizeHubspotTicket(raw, ownerMap),
  Task:                        (raw, ownerMap) => normalizeHubspotTask(raw, ownerMap),
  Note:                        (raw, ownerMap) => normalizeHubspotNote(raw, ownerMap),
  HubspotOwner:                (raw) => normalizeHubspotOwner(raw),
  Product:                     (raw) => normalizeHubspotProduct(raw),
  User:                        (raw) => normalizeHubspotUser(raw),
  HubspotKnowledgeBaseArticle: (raw) => normalizeHubspotKbArticle(raw),
  HubspotServiceTicket:        (raw, ownerMap) => normalizeHubspotServiceTicket(raw, ownerMap),
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

    // Step 3: Fetch all records from Nango, normalize, and update
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
            const rec = normalizeFn(raw as any, ownerMap, stageMap);
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

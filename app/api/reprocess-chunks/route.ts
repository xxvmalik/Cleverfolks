import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { fetchSlackUserMap, resolveSlackMentions } from "@/lib/slack-user-resolver";
import { chunkText } from "@/lib/chunking";
import { createEmbeddings } from "@/lib/embeddings";

const INNER_BATCH = 20; // embeddings are batched per call

interface SlackDoc {
  id: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = (await request.json()) as {
    workspaceId: string;
    offset?: number;
    limit?: number;
  };
  const { workspaceId, offset = 0, limit = 50 } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // ── Find Slack integration ────────────────────────────────────────────────
  const { data: integration } = await admin
    .from("integrations")
    .select("id, nango_connection_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();

  if (!integration?.nango_connection_id) {
    return NextResponse.json(
      { error: "No connected Slack integration found for this workspace" },
      { status: 404 }
    );
  }

  // ── Build user map ────────────────────────────────────────────────────────
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
  const userMap = await fetchSlackUserMap(nango, integration.nango_connection_id);

  // ── Count total Slack docs ────────────────────────────────────────────────
  const { count: total } = await admin
    .from("synced_documents")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("source_type", ["slack_message", "slack_reply"]);

  // ── Fetch this page of docs ───────────────────────────────────────────────
  const { data: docs, error: fetchErr } = await admin
    .from("synced_documents")
    .select("id, content, metadata")
    .eq("workspace_id", workspaceId)
    .in("source_type", ["slack_message", "slack_reply"])
    .range(offset, offset + limit - 1);

  if (fetchErr) {
    console.error("[reprocess] fetch error:", fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const rows = (docs ?? []) as SlackDoc[];
  let processed = 0;
  let skipped = 0;

  // ── Process in inner batches for embedding efficiency ────────────────────
  for (let i = 0; i < rows.length; i += INNER_BATCH) {
    const batch = rows.slice(i, i + INNER_BATCH);

    for (const doc of batch) {
      try {
        const rawContent = doc.content ?? "";
        const resolvedContent = resolveSlackMentions(rawContent, userMap);

        // Resolve user_name in metadata using the same map
        const meta = { ...(doc.metadata ?? {}) } as Record<string, unknown>;
        const senderId = meta.user as string | undefined;
        if (senderId && userMap[senderId]) {
          meta.user_name = userMap[senderId];
        }

        if (!resolvedContent.trim()) {
          skipped++;
          continue;
        }

        // Update document with resolved content + metadata
        const { error: updateErr } = await admin
          .from("synced_documents")
          .update({ content: resolvedContent, metadata: meta })
          .eq("id", doc.id);

        if (updateErr) {
          console.error(`[reprocess] update error for doc ${doc.id}:`, updateErr);
          skipped++;
          continue;
        }

        // Delete stale chunks
        const { error: deleteErr } = await admin.rpc("delete_chunks_for_document", {
          p_document_id: doc.id,
        });
        if (deleteErr) {
          console.error(`[reprocess] delete_chunks error for doc ${doc.id}:`, deleteErr);
          skipped++;
          continue;
        }

        // Re-chunk with resolved content
        const chunks = chunkText(resolvedContent, meta);
        if (chunks.length === 0) {
          skipped++;
          continue;
        }

        // Re-embed
        const embeddings = await createEmbeddings(chunks.map((c) => c.text));

        // Store new chunks
        let stored = 0;
        for (let j = 0; j < chunks.length; j++) {
          const embedding = embeddings[j];
          if (!embedding || embedding.length === 0) continue;

          const { error: chunkErr } = await admin.rpc("create_document_chunk", {
            p_document_id: doc.id,
            p_workspace_id: workspaceId,
            p_chunk_text: chunks[j].text,
            p_chunk_index: chunks[j].index,
            p_embedding: `[${embedding.join(",")}]`,
            p_metadata: chunks[j].metadata,
          });

          if (!chunkErr) stored++;
        }

        console.log(`[reprocess] doc=${doc.id} → ${stored} chunks stored`);
        processed++;
      } catch (err) {
        console.error(`[reprocess] unexpected error on doc ${doc.id}:`, err);
        skipped++;
      }
    }
  }

  const nextOffset = offset + rows.length;
  const hasMore = nextOffset < (total ?? 0);

  return NextResponse.json({
    ok: true,
    processed,
    skipped,
    total: total ?? 0,
    nextOffset: hasMore ? nextOffset : null,
  });
}

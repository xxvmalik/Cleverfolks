import { createServerSupabaseClient } from "@/lib/supabase-server";
import { extractText } from "@/lib/file-processor";
import { chunkText } from "@/lib/chunking";
import { createEmbeddings } from "@/lib/embeddings";

export type SyncRecord = {
  external_id: string;
  source_type:
    | "email"
    | "slack_message"
    | "calendar_event"
    | "deal"
    | "document"
    | "attachment";
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  file?: { name: string; mimeType: string; data: Buffer };
};

export async function processSyncedData(
  workspaceId: string,
  integrationId: string,
  records: SyncRecord[]
): Promise<{ processed: number; skipped: number }> {
  const supabase = await createServerSupabaseClient();
  let processed = 0;
  let skipped = 0;
  const total = records.length;

  console.log(`[processor] Starting — ${total} records, workspace=${workspaceId}`);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const label = `[processor] record[${i}] external_id=${record.external_id}`;

    try {
      // ── Step A: Extract content ──────────────────────────────────────────
      let content = "";
      if (record.file) {
        console.log(`${label} extracting file: ${record.file.name}`);
        content = await extractText(record.file.name, record.file.mimeType, record.file.data);
      } else {
        content = record.content ?? "";
      }

      if (!content.trim()) {
        console.log(`${label} skipped — empty content`);
        skipped++;
        continue;
      }

      // ── Step B: Upsert document ──────────────────────────────────────────
      console.log(`${label} upserting document (${content.length} chars)`);
      const { data: documentId, error: docError } = await supabase.rpc(
        "upsert_synced_document",
        {
          p_workspace_id: workspaceId,
          p_integration_id: integrationId,
          p_source_type: record.source_type,
          p_external_id: record.external_id,
          p_title: record.title ?? "",
          p_content: content,
          p_metadata: record.metadata ?? {},
        }
      );

      if (docError) {
        console.error(`${label} upsert_synced_document RPC error:`, docError);
        // Surface this error so the caller can detect DB/schema issues
        throw new Error(`upsert_synced_document failed: ${docError.message}`);
      }
      if (!documentId) {
        console.error(`${label} upsert_synced_document returned null — check RPC function exists`);
        throw new Error("upsert_synced_document returned null — is the SQL migration applied?");
      }

      // ── Step C: Delete old chunks ─────────────────────────────────────────
      const { error: deleteErr } = await supabase.rpc("delete_chunks_for_document", {
        p_document_id: documentId,
      });
      if (deleteErr) {
        console.error(`${label} delete_chunks_for_document error:`, deleteErr);
        throw new Error(`delete_chunks_for_document failed: ${deleteErr.message}`);
      }

      // ── Step D: Chunk text ────────────────────────────────────────────────
      const chunks = chunkText(content, {
        source_type: record.source_type,
        external_id: record.external_id,
        ...(record.metadata ?? {}),
      });

      console.log(`${label} ${chunks.length} chunk(s)`);

      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      // ── Step E: Create embeddings ─────────────────────────────────────────
      const chunkTexts = chunks.map((c) => c.text);
      let embeddings: number[][];
      try {
        embeddings = await createEmbeddings(chunkTexts);
        const empty = embeddings.filter((e) => !e || e.length === 0).length;
        if (empty > 0) {
          console.warn(`${label} ${empty}/${embeddings.length} embeddings came back empty — VOYAGE_API_KEY may be missing`);
        }
      } catch (embErr) {
        console.error(`${label} createEmbeddings threw:`, embErr);
        throw new Error(`createEmbeddings failed: ${embErr instanceof Error ? embErr.message : String(embErr)}`);
      }

      // ── Step F: Store chunks ──────────────────────────────────────────────
      let storedChunks = 0;
      for (let j = 0; j < chunks.length; j++) {
        const embedding = embeddings[j];
        if (!embedding || embedding.length === 0) {
          console.warn(`${label} chunk[${j}] skipped — no embedding`);
          continue;
        }

        const { error: chunkError } = await supabase.rpc("create_document_chunk", {
          p_document_id: documentId,
          p_workspace_id: workspaceId,
          p_chunk_text: chunks[j].text,
          p_chunk_index: chunks[j].index,
          p_embedding: `[${embedding.join(",")}]`,
          p_metadata: chunks[j].metadata,
        });

        if (chunkError) {
          console.error(`${label} create_document_chunk error (chunk ${j}):`, chunkError);
          throw new Error(`create_document_chunk failed: ${chunkError.message}`);
        }
        storedChunks++;
      }

      processed++;
      console.log(`[processor] ${processed}/${total} done — ${storedChunks} chunks stored`);

    } catch (recordErr) {
      console.error(`${label} fatal error — skipping record:`, recordErr);
      // Re-throw so the caller (sync route) can surface this to the client
      // If you'd prefer to skip bad records instead of aborting, change to: skipped++; continue;
      throw recordErr;
    }
  }

  return { processed, skipped };
}

// ============================================================
// Integration normalizers
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeGmail(raw: any): SyncRecord {
  const headers: Record<string, string> = {};
  for (const h of raw.payload?.headers ?? []) {
    headers[h.name?.toLowerCase()] = h.value;
  }

  const getBody = (payload: Record<string, unknown>): string => {
    const parts = (payload.parts as Array<Record<string, unknown>> | undefined) ?? [];
    if (parts.length > 0) {
      for (const part of parts) {
        if (part.mimeType === "text/plain") {
          const data = (part.body as Record<string, string>)?.data ?? "";
          return Buffer.from(data, "base64url").toString("utf-8");
        }
      }
      return getBody(parts[0] as Record<string, unknown>);
    }
    const data = (payload.body as Record<string, string>)?.data ?? "";
    return Buffer.from(data, "base64url").toString("utf-8");
  };

  return {
    external_id: raw.id ?? "",
    source_type: "email",
    title: headers["subject"] ?? "(No Subject)",
    content: getBody(raw.payload ?? {}),
    metadata: {
      from: headers["from"],
      to: headers["to"],
      date: headers["date"],
      thread_id: raw.threadId,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlack(raw: any): SyncRecord {
  return {
    external_id: raw.ts ?? raw.client_msg_id ?? raw.id ?? "",
    source_type: "slack_message",
    title: `Slack message in #${raw.channel ?? raw.channel_id ?? "unknown"}`,
    content: raw.text ?? "",
    metadata: {
      channel: raw.channel ?? raw.channel_id,
      user: raw.user ?? raw.user_id,
      ts: raw.ts,
      thread_ts: raw.thread_ts,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCalendar(raw: any): SyncRecord {
  const parts: string[] = [];
  if (raw.summary) parts.push(raw.summary);
  if (raw.description) parts.push(raw.description);
  if (raw.location) parts.push(`Location: ${raw.location}`);

  const attendees = (raw.attendees ?? []) as Array<{ email: string }>;
  if (attendees.length > 0) {
    parts.push(`Attendees: ${attendees.map((a) => a.email).join(", ")}`);
  }

  return {
    external_id: raw.id ?? "",
    source_type: "calendar_event",
    title: raw.summary ?? "(No Title)",
    content: parts.join("\n\n"),
    metadata: {
      start: raw.start?.dateTime ?? raw.start?.date,
      end: raw.end?.dateTime ?? raw.end?.date,
      organizer: raw.organizer?.email,
      status: raw.status,
      html_link: raw.htmlLink,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeHubspot(raw: any): SyncRecord {
  const props = raw.properties ?? {};
  const content = [
    props.dealname ? `Deal: ${props.dealname}` : "",
    props.description ?? "",
    props.notes_last_updated ? `Notes: ${props.notes_last_updated}` : "",
    props.dealstage ? `Stage: ${props.dealstage}` : "",
    props.amount ? `Amount: ${props.amount}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    external_id: raw.id ?? "",
    source_type: "deal",
    title: props.dealname ?? "(No Name)",
    content,
    metadata: {
      deal_stage: props.dealstage,
      amount: props.amount,
      close_date: props.closedate,
      owner_id: props.hubspot_owner_id,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDrive(raw: any): SyncRecord {
  return {
    external_id: raw.id ?? "",
    source_type: "document",
    title: raw.name ?? "(No Name)",
    content: raw.content ?? raw.exportedContent ?? "",
    metadata: {
      mime_type: raw.mimeType,
      web_view_link: raw.webViewLink,
      modified_time: raw.modifiedTime,
      size: raw.size,
    },
  };
}

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

  for (const record of records) {
    // 1. Extract content
    let content = "";
    if (record.file) {
      content = await extractText(
        record.file.name,
        record.file.mimeType,
        record.file.data
      );
    } else {
      content = record.content ?? "";
    }

    // 2. Skip empty content
    if (!content.trim()) {
      skipped++;
      continue;
    }

    // 3. Upsert synced document
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

    if (docError || !documentId) {
      console.error("Failed to upsert document:", docError);
      skipped++;
      continue;
    }

    // 4. Delete old chunks
    await supabase.rpc("delete_chunks_for_document", {
      p_document_id: documentId,
    });

    // 5. Chunk the content
    const chunks = chunkText(content, {
      source_type: record.source_type,
      external_id: record.external_id,
      ...(record.metadata ?? {}),
    });

    if (chunks.length === 0) {
      skipped++;
      continue;
    }

    // 6. Create embeddings
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await createEmbeddings(chunkTexts);

    // 7. Store chunks
    for (let i = 0; i < chunks.length; i++) {
      const embedding = embeddings[i];
      if (!embedding || embedding.length === 0) continue;

      const { error: chunkError } = await supabase.rpc("create_document_chunk", {
        p_document_id: documentId,
        p_workspace_id: workspaceId,
        p_chunk_text: chunks[i].text,
        p_chunk_index: chunks[i].index,
        p_embedding: `[${embedding.join(",")}]`,
        p_metadata: chunks[i].metadata,
      });

      if (chunkError) {
        console.error("Failed to create chunk:", chunkError);
      }
    }

    processed++;
    console.log(`Processed ${processed}/${total} for workspace ${workspaceId}`);
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
    external_id: raw.ts ?? raw.client_msg_id ?? "",
    source_type: "slack_message",
    title: `Slack message in #${raw.channel ?? "unknown"}`,
    content: raw.text ?? "",
    metadata: {
      channel: raw.channel,
      user: raw.user,
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

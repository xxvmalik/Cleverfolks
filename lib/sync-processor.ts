import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { extractText } from "@/lib/file-processor";
import { chunkText } from "@/lib/chunking";
import { createEmbeddings } from "@/lib/embeddings";
import { resolveSlackMentions } from "@/lib/slack-user-resolver";

export type SyncRecord = {
  external_id: string;
  source_type:
    | "email"
    | "gmail_message"
    | "gmail_contact"
    | "slack_message"
    | "slack_reply"
    | "slack_reaction"
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
  records: SyncRecord[],
  /** Pass a pre-built client (e.g. admin client from Inngest). Falls back to
   *  cookie-based server client when called from API routes. */
  supabaseOverride?: SupabaseClient
): Promise<{ processed: number; skipped: number }> {
  const supabase = supabaseOverride ?? await createServerSupabaseClient();
  let processed = 0;
  let skipped = 0;

  // Deduplicate within this batch by external_id (last writer wins)
  const seen = new Map<string, SyncRecord>();
  for (const r of records) seen.set(r.external_id, r);
  const deduped = [...seen.values()];
  if (deduped.length < records.length) {
    console.log(`[processor] Deduped ${records.length - deduped.length} duplicate external_ids in batch`);
  }

  console.log(`[processor] Starting — ${deduped.length} records (after dedup), workspace=${workspaceId}`);

  for (let i = 0; i < deduped.length; i++) {
    const record = deduped[i];
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
        // Postgres unique_violation (23505) means a concurrent insert beat us —
        // the ON CONFLICT clause should prevent this but handle it gracefully anyway.
        const isUniqueViolation =
          docError.code === "23505" ||
          docError.message?.includes("unique constraint") ||
          docError.message?.includes("duplicate key");

        if (isUniqueViolation) {
          console.warn(`${label} skipped — unique constraint violation (duplicate external_id)`);
          skipped++;
          continue;
        }

        // Any other DB/schema error should still surface so we know if the
        // SQL migration hasn't been applied yet.
        console.error(`${label} upsert_synced_document RPC error:`, docError);
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
      console.log(`[processor] ${processed}/${deduped.length} done — ${storedChunks} chunks stored`);

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
// Slack lookup helpers
// ============================================================

/** Plain-object maps for JSON serialization across Inngest step boundaries. */
export type SlackLookups = {
  users: Record<string, string>;    // user_id → display name
  channels: Record<string, string>; // channel_id → channel name
  /** ts → resolved message text; built during SlackMessage pass for reply context */
  messages?: Record<string, string>;
};

export function resolveSlackUser(userId: string, lookups?: SlackLookups): string {
  return lookups?.users[userId] ?? userId;
}

export function resolveSlackChannel(channelId: string, lookups?: SlackLookups): string {
  return lookups?.channels[channelId] ?? channelId;
}

// ============================================================
// Integration normalizers
// ============================================================

// ============================================================
// Gmail helpers
// ============================================================

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PROMO_PATTERNS = [
  /unsubscribe/i,
  /view (this email |it )?in (your |a )?browser/i,
  /sent from my (iphone|ipad|android|samsung|galaxy)/i,
  /get (outlook|the app) (for|on) (ios|android)/i,
  /copyright \d{4}/i,
  /all rights reserved/i,
  /privacy policy/i,
  /you (are receiving|received) this (email|message) because/i,
  /to (manage|update|change) your (subscription|preferences|email)/i,
  /click here to (unsubscribe|opt.?out)/i,
];

/** Remove promotional footer lines (scan last 30 lines from bottom) */
function removePromotionalFooter(text: string): string {
  const lines = text.split("\n");
  let cutAt = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const line = lines[i].trim();
    if (PROMO_PATTERNS.some((re) => re.test(line))) cutAt = i;
  }
  return lines.slice(0, cutAt).join("\n").trim();
}

/** Strip > quoted reply lines; return clean body + short reference snippet */
function extractQuotedReply(text: string): { body: string; quotedRef: string | null } {
  const lines = text.split("\n");
  const bodyLines: string[] = [];
  const quotedLines: string[] = [];
  let inQuote = false;

  for (const line of lines) {
    if (/^On .+wrote:$/.test(line.trim()) || /^From:.*Sent:/.test(line)) {
      inQuote = true;
      continue;
    }
    if (line.startsWith(">")) {
      inQuote = true;
      quotedLines.push(line.replace(/^>+\s?/, ""));
      continue;
    }
    if (!inQuote) bodyLines.push(line);
  }

  return {
    body: bodyLines.join("\n").trim(),
    quotedRef:
      quotedLines.length > 0
        ? quotedLines.slice(0, 5).join(" ").slice(0, 200).trim()
        : null,
  };
}

/** Extract text body from Gmail API payload (handles multipart recursively) */
function extractGmailBody(payload: Record<string, unknown>): { text: string; isHtml: boolean } {
  const mimeType = (payload.mimeType as string | undefined) ?? "";

  if (mimeType.startsWith("multipart/")) {
    const parts = (payload.parts as Array<Record<string, unknown>> | undefined) ?? [];
    for (const part of parts) {
      if (part.mimeType === "text/plain") {
        const data = (part.body as Record<string, string>)?.data ?? "";
        if (data) return { text: Buffer.from(data, "base64url").toString("utf-8"), isHtml: false };
      }
    }
    for (const part of parts) {
      if (part.mimeType === "text/html") {
        const data = (part.body as Record<string, string>)?.data ?? "";
        if (data) return { text: Buffer.from(data, "base64url").toString("utf-8"), isHtml: true };
      }
    }
    for (const part of parts) {
      if ((part.mimeType as string | undefined)?.startsWith("multipart/")) {
        return extractGmailBody(part);
      }
    }
  }

  const data = (payload.body as Record<string, string>)?.data ?? "";
  if (!data) return { text: "", isHtml: false };
  return { text: Buffer.from(data, "base64url").toString("utf-8"), isHtml: mimeType === "text/html" };
}

/** Parse "Display Name <email@domain.com>" → { name, email } */
function parseFromHeader(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^["']|["']$/g, ""), email: match[2].trim().toLowerCase() };
  }
  return { name: from.trim(), email: from.trim().toLowerCase() };
}

/** Check if payload has non-inline file attachments */
function hasGmailAttachments(payload: Record<string, unknown>): boolean {
  const parts = (payload.parts as Array<Record<string, unknown>> | undefined) ?? [];
  return parts.some((p) => {
    const disp =
      (p.headers as Array<{ name: string; value: string }> | undefined)
        ?.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
    return disp.startsWith("attachment") && !!(p.body as Record<string, string>)?.attachmentId;
  });
}

/** Build email → display name map from raw GmailContact records */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGmailContactMap(contacts: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const contact of contacts) {
    const emailAddresses: Array<{ value?: string }> = contact.emailAddresses ?? [];
    const names: Array<{ displayName?: string; givenName?: string; familyName?: string }> =
      contact.names ?? [];
    const displayName =
      names[0]?.displayName ??
      [names[0]?.givenName, names[0]?.familyName].filter(Boolean).join(" ") ??
      "";
    for (const ea of emailAddresses) {
      if (ea.value && displayName) map[ea.value.toLowerCase()] = displayName;
    }
  }
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeGmail(raw: any, contactMap?: Record<string, string>): SyncRecord {
  const headers: Record<string, string> = {};
  for (const h of (raw.payload?.headers ?? []) as Array<{ name: string; value: string }>) {
    headers[h.name.toLowerCase()] = h.value;
  }

  const subject = headers["subject"] ?? "(No Subject)";
  const fromHeader = headers["from"] ?? "";
  const toHeader = headers["to"] ?? "";
  const dateHeader = headers["date"] ?? "";

  const { name: senderNameRaw, email: senderEmail } = parseFromHeader(fromHeader);
  const senderName = (contactMap && contactMap[senderEmail]) ?? senderNameRaw;

  const recipients = toHeader
    ? toHeader
        .split(",")
        .map((r) => parseFromHeader(r.trim()).email)
        .filter(Boolean)
    : [];

  const { text: rawBodyText, isHtml } = extractGmailBody(raw.payload ?? {});
  const bodyText = isHtml ? stripHtml(rawBodyText) : rawBodyText;
  const cleanBody = removePromotionalFooter(bodyText);
  const { body, quotedRef } = extractQuotedReply(cleanBody);

  const content = quotedRef ? `[Replying to: ${quotedRef}]\n${body}` : body;

  // Convert Date header to Unix timestamp float string (for time-range SQL)
  let ts: string | undefined;
  try {
    if (dateHeader) {
      const parsed = new Date(dateHeader);
      if (!isNaN(parsed.getTime())) ts = String(parsed.getTime() / 1000);
    }
  } catch { /* ignore */ }
  if (!ts && raw.internalDate) ts = String(Number(raw.internalDate) / 1000);

  return {
    external_id: raw.id ?? "",
    source_type: "gmail_message",
    title: subject,
    content: content || body || rawBodyText,
    metadata: {
      sender_name: senderName || undefined,
      sender_email: senderEmail || undefined,
      user_name: senderName || senderEmail || undefined,
      from: fromHeader,
      to: toHeader,
      recipients,
      subject,
      date: dateHeader,
      thread_id: raw.threadId ?? undefined,
      labels: (raw.labelIds ?? []) as string[],
      has_attachments: hasGmailAttachments(raw.payload ?? {}),
      ts,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeGmailContact(raw: any): SyncRecord {
  const names: Array<{ displayName?: string; givenName?: string; familyName?: string }> =
    raw.names ?? [];
  const emailAddresses: Array<{ value?: string }> = raw.emailAddresses ?? [];
  const phoneNumbers: Array<{ value?: string }> = raw.phoneNumbers ?? [];
  const organizations: Array<{ name?: string; title?: string }> = raw.organizations ?? [];

  const displayName =
    names[0]?.displayName ??
    [names[0]?.givenName, names[0]?.familyName].filter(Boolean).join(" ") ??
    "Unknown Contact";

  const primaryEmail = emailAddresses[0]?.value ?? "";

  const parts: string[] = [];
  if (displayName) parts.push(`Name: ${displayName}`);
  if (primaryEmail) parts.push(`Email: ${primaryEmail}`);
  if (emailAddresses.length > 1) {
    parts.push(
      `Other emails: ${emailAddresses
        .slice(1)
        .map((e) => e.value)
        .filter(Boolean)
        .join(", ")}`
    );
  }
  if (phoneNumbers.length > 0) {
    parts.push(`Phone: ${phoneNumbers.map((p) => p.value).filter(Boolean).join(", ")}`);
  }
  if (organizations[0]?.name) parts.push(`Company: ${organizations[0].name}`);
  if (organizations[0]?.title) parts.push(`Title: ${organizations[0].title}`);

  const resourceName: string = raw.resourceName ?? raw.id ?? "";
  const contactId = resourceName.replace("people/", "") || (raw.id ?? "");

  return {
    external_id: `contact_${contactId}`,
    source_type: "gmail_contact",
    title: displayName,
    content: parts.join("\n"),
    metadata: {
      resource_name: resourceName,
      email: primaryEmail,
      display_name: displayName,
      organization: organizations[0]?.name ?? undefined,
      title: organizations[0]?.title ?? undefined,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlack(raw: any, lookups?: SlackLookups): SyncRecord {
  // Nango's SlackMessage model: id, ts, text, channel_id, user, thread_ts, etc.
  const channelId: string = raw.channel_id ?? raw.channel ?? "unknown";
  const userId: string = raw.user ?? raw.user_id ?? raw.username ?? "";
  const channelName = resolveSlackChannel(channelId, lookups);
  const userName = userId ? resolveSlackUser(userId, lookups) : undefined;
  const messageId: string = raw.id ?? raw.ts ?? raw.client_msg_id ?? "";
  const rawText: string = raw.text ?? "";
  const text = lookups?.users ? resolveSlackMentions(rawText, lookups.users) : rawText;

  return {
    external_id: messageId,
    source_type: "slack_message",
    title: `Slack message in #${channelName}`,
    content: text,
    metadata: {
      channel_id: channelId,
      channel_name: channelName,
      user: userId,
      ...(userName ? { user_name: userName } : {}),
      ts: raw.ts,
      thread_ts: raw.thread_ts ?? null,
      subtype: raw.subtype ?? null,
      // preserve the full raw shape for debugging
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlackReply(raw: any, lookups?: SlackLookups): SyncRecord {
  // Nango's SlackMessageReply model: same shape as SlackMessage plus thread_ts
  const channelId: string = raw.channel_id ?? raw.channel ?? "unknown";
  const userId: string = raw.user ?? raw.user_id ?? raw.username ?? "";
  const channelName = resolveSlackChannel(channelId, lookups);
  const userName = userId ? resolveSlackUser(userId, lookups) : undefined;
  const messageId: string = raw.id ?? raw.ts ?? raw.client_msg_id ?? "";
  const rawText: string = raw.text ?? "";
  const resolvedText = lookups?.users ? resolveSlackMentions(rawText, lookups.users) : rawText;

  // Prepend parent message so the chunk is self-contained for semantic search.
  // e.g. "[Replying to: 8115 failed @Operation Manager @ALLI]\nall completed now"
  const parentTs: string = raw.thread_ts ?? "";
  const parentText: string | undefined = parentTs ? lookups?.messages?.[parentTs] : undefined;
  const content = parentText
    ? `[Replying to: ${parentText.slice(0, 200).trim()}]\n${resolvedText}`
    : resolvedText;

  return {
    external_id: messageId,
    source_type: "slack_reply",
    title: parentText
      ? `Reply to "${parentText.slice(0, 60).trim()}…" in #${channelName}`
      : `Reply in #${channelName}`,
    content,
    metadata: {
      channel_id: channelId,
      channel_name: channelName,
      user: userId,
      ...(userName ? { user_name: userName } : {}),
      ts: raw.ts,
      thread_ts: raw.thread_ts ?? null,
      parent_message_ts: raw.thread_ts ?? null,
      has_parent_context: !!parentText,
      subtype: raw.subtype ?? null,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlackReaction(raw: any, lookups?: SlackLookups): SyncRecord {
  // Nango's SlackMessageReaction model: reaction, user, message_ts, channel_id
  const emoji: string = raw.reaction ?? raw.name ?? "unknown";
  const userId: string = raw.user ?? raw.user_id ?? "unknown";
  const channelId: string = raw.channel_id ?? raw.channel ?? "unknown";
  const channelName = resolveSlackChannel(channelId, lookups);
  const userName = resolveSlackUser(userId, lookups);
  const messageTs: string = raw.message_ts ?? raw.ts ?? "";

  // Always build a composite key — raw.id is often the parent message ts
  // (shared across all reactions on that message) and cannot be used alone.
  const uniqueId = `reaction-${messageTs}-${emoji}-${userId}`;

  return {
    external_id: uniqueId,
    source_type: "slack_reaction",
    title: `Reaction :${emoji}: in #${channelName}`,
    content: `${userName} reacted with :${emoji}: to message in #${channelName}`,
    metadata: {
      emoji,
      user: userId,
      user_name: userName,
      channel_id: channelId,
      channel_name: channelName,
      message_ts: messageTs,
      count: raw.count ?? null,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlackChannel(raw: any): SyncRecord {
  // Nango's SlackChannel model: id, name, purpose, topic, is_archived, num_members, etc.
  const parts: string[] = [];
  if (raw.name) parts.push(`Channel: #${raw.name}`);
  if (raw.topic?.value) parts.push(`Topic: ${raw.topic.value}`);
  if (raw.purpose?.value) parts.push(`Purpose: ${raw.purpose.value}`);
  if (raw.num_members != null) parts.push(`Members: ${raw.num_members}`);

  return {
    external_id: raw.id ?? "",
    source_type: "document",
    title: `#${raw.name ?? raw.id ?? "unknown-channel"}`,
    content: parts.join("\n") || `Slack channel #${raw.name ?? raw.id}`,
    metadata: {
      channel_id: raw.id,
      name: raw.name,
      is_archived: raw.is_archived ?? false,
      is_private: raw.is_private ?? false,
      num_members: raw.num_members,
      created: raw.created,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSlackUser(raw: any): SyncRecord {
  // Nango's SlackUser model: id, name, real_name, profile (title, email, display_name, etc.)
  const profile = raw.profile ?? {};
  const parts: string[] = [];
  if (raw.real_name) parts.push(`Name: ${raw.real_name}`);
  if (profile.title) parts.push(`Title: ${profile.title}`);
  if (profile.email) parts.push(`Email: ${profile.email}`);
  if (profile.display_name && profile.display_name !== raw.real_name) {
    parts.push(`Display name: ${profile.display_name}`);
  }
  if (raw.tz_label) parts.push(`Timezone: ${raw.tz_label}`);

  return {
    external_id: raw.id ?? "",
    source_type: "document",
    title: raw.real_name ?? profile.display_name ?? raw.name ?? raw.id ?? "Unknown user",
    content: parts.join("\n") || `Slack user ${raw.real_name ?? raw.name ?? raw.id}`,
    metadata: {
      user_id: raw.id,
      username: raw.name,
      real_name: raw.real_name,
      email: profile.email,
      title: profile.title,
      is_bot: raw.is_bot ?? false,
      deleted: raw.deleted ?? false,
      _raw_keys: Object.keys(raw).filter((k) => !k.startsWith("_nango")),
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

import { createEmbedding } from "@/lib/embeddings";
import { searchWeb, type WebResult } from "@/lib/web-search";
import type { UnifiedResult } from "@/lib/strategy-executor";
import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

type ToolContext = {
  input: Record<string, unknown>;
  workspaceId: string;
  adminSupabase: AdminDb;
};

export type ToolHandlerResult = {
  results: UnifiedResult[] | WebResult[];
  /** Human-readable summary for Claude to reason about */
  summary: string;
};

// ── search_knowledge_base ─────────────────────────────────────────────────────

export async function handleSearchKnowledgeBase(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const query = input.query as string;
  const after = (input.after as string) ?? null;
  const before = (input.before as string) ?? null;
  const sourceTypes = (input.source_types as string[] | undefined)?.length
    ? (input.source_types as string[])
    : null;

  try {
    const queryEmbedding = await createEmbedding(query);

    if (!queryEmbedding.length) {
      console.warn("[tool-handler] search_knowledge_base: empty embedding");
      return { results: [], summary: "Embedding generation failed — no results." };
    }

    const { data, error } = await adminSupabase.rpc("hybrid_search_documents", {
      p_workspace_id: workspaceId,
      p_query_embedding: `[${queryEmbedding.join(",")}]`,
      p_query_text: query,
      p_match_count: 15,
      p_match_threshold: 0.2,
      p_after: after,
      p_before: before,
      p_source_types: sourceTypes,
    });

    if (error) {
      console.error("[tool-handler] search_knowledge_base error:", error);
      return { results: [], summary: `Search failed: ${error.message}` };
    }

    const results = (data ?? []) as UnifiedResult[];
    console.log(
      `[tool-handler] search_knowledge_base: query="${query}" → ${results.length} results`
    );

    return {
      results,
      summary: results.length > 0
        ? `Found ${results.length} relevant results for "${query}".`
        : `No results found for "${query}".`,
    };
  } catch (err) {
    console.error("[tool-handler] search_knowledge_base exception:", err);
    return { results: [], summary: "Search failed due to an internal error." };
  }
}

// ── fetch_recent_messages ─────────────────────────────────────────────────────

export async function handleFetchRecentMessages(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const after = (input.after as string) ?? null;
  const before = (input.before as string) ?? null;
  const sourceTypes = (input.source_types as string[] | undefined)?.length
    ? (input.source_types as string[])
    : null;
  const limit = (input.limit as number) ?? 150;

  try {
    const { data, error } = await adminSupabase.rpc("fetch_chunks_by_timerange", {
      p_workspace_id: workspaceId,
      p_after: after,
      p_before: before,
      p_limit: limit,
      p_source_types: sourceTypes,
    });

    if (error) {
      console.error("[tool-handler] fetch_recent_messages error:", error);
      return { results: [], summary: `Fetch failed: ${error.message}` };
    }

    const rawResults = (
      (data ?? []) as Omit<UnifiedResult, "similarity">[]
    ).map((r) => ({
      ...r,
      document_id: r.document_id ?? r.chunk_id,
      title: r.title ?? "",
      similarity: 0,
    }));

    // Enrich calendar event results — surface times in text Claude can see
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = rawResults.map((chunk: any) => {
      const sourceType = chunk.metadata?.source_type;
      if (sourceType === 'outlook_event' || sourceType === 'calendar_event') {
        const eventStart = chunk.metadata?.start;
        const eventEnd = chunk.metadata?.end;
        if (eventStart) {
          // Format the times for readability
          const startDate = new Date(eventStart);
          const endDate = eventEnd ? new Date(eventEnd) : null;

          const formatTime = (d: Date) => {
            return d.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });
          };

          const timePrefix = endDate
            ? `[EVENT TIME: ${formatTime(startDate)} to ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]\n`
            : `[EVENT TIME: ${formatTime(startDate)}]\n`;

          return {
            ...chunk,
            chunk_text: timePrefix + chunk.chunk_text,
            metadata: {
              ...chunk.metadata,
              _event_start_local: eventStart,
              _event_end_local: eventEnd,
              _is_calendar_event: true,
            }
          };
        }
      }
      return chunk;
    });

    console.log(
      `[tool-handler] fetch_recent_messages: after=${after} before=${before} → ${results.length} messages`
    );

    return {
      results,
      summary: results.length > 0
        ? `Fetched ${results.length} messages from the specified time range.`
        : "No messages found in the specified time range.",
    };
  } catch (err) {
    console.error("[tool-handler] fetch_recent_messages exception:", err);
    return { results: [], summary: "Fetch failed due to an internal error." };
  }
}

// ── count_messages_by_person ──────────────────────────────────────────────────

export async function handleCountMessagesByPerson(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const after = (input.after as string) ?? null;
  const before = (input.before as string) ?? null;
  const sourceTypes = (input.source_types as string[] | undefined)?.length
    ? (input.source_types as string[])
    : null;
  const dedicatedChannels = (
    (input.dedicated_channels as string[]) ?? []
  ).filter(Boolean);
  const keywords = ((input.keywords as string[]) ?? []).filter(Boolean);

  try {
    // Run both SQL aggregations + a 300-message qualitative sample in parallel
    const [dedicatedResult, othersResult, sampleResult] = await Promise.all([
      dedicatedChannels.length > 0
        ? adminSupabase.rpc("aggregate_by_person_in_channels", {
            p_workspace_id: workspaceId,
            p_channels: dedicatedChannels,
            p_after: after,
            p_before: before,
            p_limit: 100,
            p_source_types: sourceTypes,
          })
        : Promise.resolve({ data: [], error: null }),
      keywords.length > 0
        ? adminSupabase.rpc("aggregate_by_person_keyword_others", {
            p_workspace_id: workspaceId,
            p_keywords: keywords,
            p_exclude_channels:
              dedicatedChannels.length > 0 ? dedicatedChannels : null,
            p_after: after,
            p_before: before,
            p_limit: 100,
            p_source_types: sourceTypes,
          })
        : Promise.resolve({ data: [], error: null }),
      adminSupabase.rpc("fetch_chunks_by_timerange", {
        p_workspace_id: workspaceId,
        p_after: after,
        p_before: before,
        p_limit: 300,
        p_source_types: sourceTypes,
      }),
    ]);

    if (dedicatedResult.error) {
      console.error("[tool-handler] count dedicated error:", dedicatedResult.error);
    }
    if (othersResult.error) {
      console.error("[tool-handler] count others error:", othersResult.error);
    }
    if (sampleResult.error) {
      console.error("[tool-handler] count sample error:", sampleResult.error);
    }

    // Merge counts per person
    type CountRow = { user_name: string; message_count: number | string };
    const totals = new Map<string, number>();
    for (const row of (dedicatedResult.data ?? []) as CountRow[]) {
      if (row.user_name) {
        totals.set(
          row.user_name,
          (totals.get(row.user_name) ?? 0) + Number(row.message_count)
        );
      }
    }
    for (const row of (othersResult.data ?? []) as CountRow[]) {
      if (row.user_name) {
        totals.set(
          row.user_name,
          (totals.get(row.user_name) ?? 0) + Number(row.message_count)
        );
      }
    }

    // Sort by total descending
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);

    const countText =
      sorted.length > 0
        ? sorted.map(([name, count]) => `${name}: ${count}`).join("\n")
        : "(no results — keywords may need adjustment)";

    const countResult: UnifiedResult = {
      chunk_id: "aggregation_counts_default",
      document_id: "aggregation_counts_default",
      title: "Aggregated Message Counts",
      chunk_text:
        `EXACT MESSAGE COUNTS (SQL aggregate — scales to any volume):\n` +
        countText,
      source_type: "aggregation_counts",
      metadata: { dedicated_channels: dedicatedChannels, keywords },
      similarity: 1,
      msg_ts: null,
    };

    const sampleMessages = (
      (sampleResult.data ?? []) as Omit<UnifiedResult, "similarity">[]
    ).map((r) => ({
      ...r,
      document_id: r.document_id ?? r.chunk_id,
      title: r.title ?? "",
      similarity: 0,
    }));

    console.log(
      `[tool-handler] count_messages_by_person: ${sorted.length} people counted, ` +
        `${sampleMessages.length} sample messages`
    );

    return {
      results: [countResult, ...sampleMessages],
      summary:
        sorted.length > 0
          ? `Counted messages for ${sorted.length} people. Top: ${sorted
              .slice(0, 5)
              .map(([n, c]) => `${n} (${c})`)
              .join(", ")}.`
          : "No message counts found for the specified criteria.",
    };
  } catch (err) {
    console.error("[tool-handler] count_messages_by_person exception:", err);
    return { results: [], summary: "Counting failed due to an internal error." };
  }
}

// ── search_by_person ──────────────────────────────────────────────────────────

export async function handleSearchByPerson(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const personName = input.person_name as string;
  const after = (input.after as string) ?? null;
  const before = (input.before as string) ?? null;

  try {
    const { data, error } = await adminSupabase.rpc("search_by_person", {
      p_workspace_id: workspaceId,
      p_person_name: personName,
      p_after: after,
      p_before: before,
      p_limit: 30,
    });

    if (error) {
      console.error("[tool-handler] search_by_person error:", error);
      return { results: [], summary: `Person search failed: ${error.message}` };
    }

    const results = (
      (data ?? []) as Omit<UnifiedResult, "similarity">[]
    ).map((r) => ({
      ...r,
      similarity: 0,
      match_type: (r as Record<string, unknown>).match_type as
        | string
        | undefined,
    }));

    console.log(
      `[tool-handler] search_by_person: "${personName}" → ${results.length} results`
    );

    return {
      results,
      summary:
        results.length > 0
          ? `Found ${results.length} messages from/about "${personName}".`
          : `No messages found for "${personName}".`,
    };
  } catch (err) {
    console.error("[tool-handler] search_by_person exception:", err);
    return { results: [], summary: "Person search failed due to an internal error." };
  }
}

// ── search_web ────────────────────────────────────────────────────────────────

export async function handleSearchWeb(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input } = ctx;
  const query = input.query as string;
  const maxResults = (input.max_results as number) ?? 5;

  try {
    const results = await searchWeb(query, maxResults);

    console.log(
      `[tool-handler] search_web: "${query}" → ${results.length} results`
    );

    return {
      results,
      summary:
        results.length > 0
          ? `Found ${results.length} web results for "${query}".`
          : `No web results found for "${query}".`,
    };
  } catch (err) {
    console.error("[tool-handler] search_web exception:", err);
    return { results: [], summary: "Web search failed due to an internal error." };
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const HANDLERS: Record<
  string,
  (ctx: ToolContext) => Promise<ToolHandlerResult>
> = {
  search_knowledge_base: handleSearchKnowledgeBase,
  fetch_recent_messages: handleFetchRecentMessages,
  count_messages_by_person: handleCountMessagesByPerson,
  search_by_person: handleSearchByPerson,
  search_web: handleSearchWeb,
};

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<ToolHandlerResult> {
  const handler = HANDLERS[toolName];
  if (!handler) {
    console.warn(`[tool-handler] Unknown tool: ${toolName}`);
    return { results: [], summary: `Unknown tool: ${toolName}` };
  }
  return handler({ input, workspaceId, adminSupabase });
}

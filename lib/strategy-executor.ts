import type { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { SearchStrategy } from "./query-planner";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

/** Unified result type — superset of both SearchResult and ChronologicalResult. */
export type UnifiedResult = {
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_text: string;
  source_type: string;
  metadata: Record<string, unknown>;
  /** 0 for non-semantic results */
  similarity: number;
  msg_ts: string | null;
  /** 'authored' | 'mentioned' — only set for person_search results */
  match_type?: string;
};

type ExecutorParams = {
  strategies: SearchStrategy[];
  workspaceId: string;
  queryEmbedding: number[];
  queryText: string;
  adminSupabase: AdminDb;
  /**
   * When the strategy list contains ONLY surrounding_context (no main search
   * strategies), these existing results are used as the target set instead of
   * running a fresh search first.  This lets the agentic loop enrich current
   * results with conversation context without re-running the primary query.
   */
  seedResults?: UnifiedResult[];
};

// ── Individual strategy runners ───────────────────────────────────────────────

async function runStrategy(
  strategy: SearchStrategy,
  workspaceId: string,
  queryEmbedding: number[],
  queryText: string,
  adminSupabase: AdminDb
): Promise<UnifiedResult[]> {
  // These are handled at the orchestration level, not here
  if (
    strategy.type === "profile_only" ||
    strategy.type === "surrounding_context"
  ) {
    return [];
  }

  if (strategy.type === "hybrid_aggregation") {
    const dedicatedChannels = (strategy.params.dedicated_channels ?? []).filter(Boolean);
    const keywords = (strategy.params.keywords ?? []).filter(Boolean);

    // Run both SQL aggregations + a 300-message qualitative sample in parallel.
    // dedicated channels: count ALL messages (no keyword filter)
    // other channels: count keyword-matched messages only
    // sample: chronological broad fetch for qualitative context
    const sourceTypes = strategy.params.source_types?.length
      ? strategy.params.source_types
      : null;

    console.log(
      `[strategy-executor] hybrid_aggregation p_source_types=${JSON.stringify(sourceTypes)} ` +
      `dedicated_channels=[${dedicatedChannels.join(",")}] keywords=[${keywords.length}]`
    );

    const [dedicatedResult, othersResult, sampleResult] = await Promise.all([
      dedicatedChannels.length > 0
        ? adminSupabase.rpc("aggregate_by_person_in_channels", {
            p_workspace_id: workspaceId,
            p_channels: dedicatedChannels,
            p_after: strategy.params.after ?? null,
            p_before: strategy.params.before ?? null,
            p_limit: 100,
            p_source_types: sourceTypes,
          })
        : Promise.resolve({ data: [], error: null }),
      keywords.length > 0
        ? adminSupabase.rpc("aggregate_by_person_keyword_others", {
            p_workspace_id: workspaceId,
            p_keywords: keywords,
            p_exclude_channels: dedicatedChannels.length > 0 ? dedicatedChannels : null,
            p_after: strategy.params.after ?? null,
            p_before: strategy.params.before ?? null,
            p_limit: 100,
            p_source_types: sourceTypes,
          })
        : Promise.resolve({ data: [], error: null }),
      adminSupabase.rpc("fetch_chunks_by_timerange", {
        p_workspace_id: workspaceId,
        p_after: strategy.params.after ?? null,
        p_before: strategy.params.before ?? null,
        p_limit: 300,
        p_source_types: sourceTypes,
      }),
    ]);

    if (dedicatedResult.error) {
      console.error("[strategy-executor] hybrid_aggregation dedicated error:", dedicatedResult.error);
    }
    if (othersResult.error) {
      console.error("[strategy-executor] hybrid_aggregation others error:", othersResult.error);
    }
    if (sampleResult.error) {
      console.error("[strategy-executor] hybrid_aggregation sample error:", sampleResult.error);
    }

    // Merge counts per person: sum dedicated + other-channel counts
    type CountRow = { user_name: string; message_count: number | string };
    const totals = new Map<string, number>();
    for (const row of (dedicatedResult.data ?? []) as CountRow[]) {
      if (row.user_name) {
        totals.set(row.user_name, (totals.get(row.user_name) ?? 0) + Number(row.message_count));
      }
    }
    for (const row of (othersResult.data ?? []) as CountRow[]) {
      if (row.user_name) {
        totals.set(row.user_name, (totals.get(row.user_name) ?? 0) + Number(row.message_count));
      }
    }

    // Sort by total descending
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);

    const countText =
      sorted.length > 0
        ? sorted.map(([name, count]) => `${name}: ${count}`).join("\n")
        : "(no results — keywords may need adjustment)";

    const periodHeader = strategy.params.label
      ? `EXACT MESSAGE COUNTS — ${strategy.params.label} (SQL aggregate):\n`
      : `EXACT MESSAGE COUNTS (SQL aggregate — scales to any volume):\n`;

    const countResult: UnifiedResult = {
      // Use a unique chunk_id per period so comparison queries produce two distinct count rows
      chunk_id: `aggregation_counts_${strategy.params.label ?? "default"}`,
      document_id: `aggregation_counts_${strategy.params.label ?? "default"}`,
      title: "Aggregated Message Counts",
      chunk_text: periodHeader + countText,
      source_type: "aggregation_counts",
      metadata: {
        dedicated_channels: dedicatedChannels,
        keywords,
        period_label: strategy.params.label,
      },
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
      `[strategy-executor] hybrid_aggregation: ${sorted.length} people counted, ` +
      `${sampleMessages.length} sample messages (dedicated=${dedicatedChannels.join(",") || "none"}, ` +
      `keywords=${keywords.length})`
    );

    // Count result goes first so Claude sees it immediately before the sample
    return [countResult, ...sampleMessages];
  }

  if (strategy.type === "semantic") {
    if (!queryEmbedding.length) {
      console.warn("[strategy-executor] No embedding — skipping semantic");
      return [];
    }
    const { data, error } = await adminSupabase.rpc("hybrid_search_documents", {
      p_workspace_id: workspaceId,
      p_query_embedding: `[${queryEmbedding.join(",")}]`,
      p_query_text: strategy.params.query ?? queryText,
      p_match_count: 15,
      p_match_threshold: 0.2,
      p_after: strategy.params.after ?? null,
      p_before: strategy.params.before ?? null,
    });
    if (error) {
      console.error("[strategy-executor] semantic error:", error);
      return [];
    }
    return (data ?? []) as UnifiedResult[];
  }

  if (strategy.type === "broad_fetch") {
    const sourceTypes = strategy.params.source_types?.length
      ? strategy.params.source_types
      : null;
    const { data, error } = await adminSupabase.rpc(
      "fetch_chunks_by_timerange",
      {
        p_workspace_id: workspaceId,
        p_after: strategy.params.after ?? null,
        p_before: strategy.params.before ?? null,
        p_limit: 150,
        p_source_types: sourceTypes,
      }
    );
    if (error) {
      console.error("[strategy-executor] broad_fetch error:", error);
      return [];
    }
    return ((data ?? []) as Omit<UnifiedResult, "similarity">[]).map((r) => ({
      ...r,
      document_id: r.document_id ?? r.chunk_id,
      title: r.title ?? "",
      similarity: 0,
    }));
  }

  if (strategy.type === "person_search") {
    if (!strategy.params.person_name) {
      console.warn("[strategy-executor] person_search missing person_name");
      return [];
    }
    const { data, error } = await adminSupabase.rpc("search_by_person", {
      p_workspace_id: workspaceId,
      p_person_name: strategy.params.person_name,
      p_after: strategy.params.after ?? null,
      p_before: strategy.params.before ?? null,
      p_limit: 30,
    });
    if (error) {
      console.error("[strategy-executor] person_search error:", error);
      return [];
    }
    return ((data ?? []) as Omit<UnifiedResult, "similarity">[]).map((r) => ({
      ...r,
      similarity: 0,
      match_type: (r as Record<string, unknown>).match_type as string | undefined,
    }));
  }

  if (strategy.type === "channel_search") {
    if (!strategy.params.channel_name) {
      console.warn("[strategy-executor] channel_search missing channel_name");
      return [];
    }
    const { data, error } = await adminSupabase.rpc("search_by_channel", {
      p_workspace_id: workspaceId,
      p_channel_name: strategy.params.channel_name,
      p_after: strategy.params.after ?? null,
      p_before: strategy.params.before ?? null,
      p_limit: 30,
    });
    if (error) {
      console.error("[strategy-executor] channel_search error:", error);
      return [];
    }
    return ((data ?? []) as Omit<UnifiedResult, "similarity">[]).map((r) => ({
      ...r,
      similarity: 0,
    }));
  }



  return [];
}

// ── Surrounding context fetcher ───────────────────────────────────────────────

async function fetchSurroundingChunks(
  chunkId: string,
  workspaceId: string,
  adminSupabase: AdminDb
): Promise<UnifiedResult[]> {
  const { data, error } = await adminSupabase.rpc(
    "fetch_surrounding_chunks",
    {
      p_chunk_id: chunkId,
      p_workspace_id: workspaceId,
      p_window: 3,
    }
  );
  if (error) {
    console.error("[strategy-executor] fetch_surrounding_chunks error:", error);
    return [];
  }
  return (
    (data ?? []) as Array<{
      chunk_id: string;
      chunk_text: string;
      source_type: string;
      metadata: Record<string, unknown>;
      msg_ts: string | null;
    }>
  ).map((r) => ({
    chunk_id: r.chunk_id,
    // Use chunk_id as document_id so deduplication works per-chunk
    document_id: r.chunk_id,
    title: "",
    chunk_text: r.chunk_text,
    source_type: r.source_type,
    metadata: r.metadata,
    similarity: 0,
    msg_ts: r.msg_ts,
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function executeStrategies({
  strategies,
  workspaceId,
  queryEmbedding,
  queryText,
  adminSupabase,
  seedResults,
}: ExecutorParams): Promise<UnifiedResult[]> {
  const mainStrategies = strategies.filter(
    (s) => s.type !== "surrounding_context"
  );
  const surroundingStrategies = strategies.filter(
    (s) => s.type === "surrounding_context"
  );

  // Run all non-surrounding strategies in parallel
  const strategyResultArrays: UnifiedResult[][] = await Promise.all(
    mainStrategies.map((s) =>
      runStrategy(s, workspaceId, queryEmbedding, queryText, adminSupabase)
    )
  );

  // If no main strategies ran, fall back to seedResults so that a
  // surrounding_context-only follow-up can enrich existing results.
  // When a strategy has params.label (comparison query), tag every result it
  // produced with period_label in metadata so the context builder can group them.
  let allResults: UnifiedResult[] =
    mainStrategies.length > 0
      ? strategyResultArrays.flatMap((results, i) => {
          const label = mainStrategies[i].params.label;
          if (!label) return results;
          return results.map((r) => ({
            ...r,
            metadata: {
              ...(r.metadata ?? {}),
              // Don't overwrite if the result already carries a period label
              // (hybrid_aggregation sets it on the count result itself)
              period_label: (r.metadata?.period_label as string | undefined) ?? label,
            },
          }));
        })
      : (seedResults ?? []);

  // Apply surrounding context if requested
  if (surroundingStrategies.length > 0 && allResults.length > 0) {
    let contextTargets: UnifiedResult[] = [];

    for (const surroundingStrategy of surroundingStrategies) {
      const applyTo = surroundingStrategy.params.apply_to;

      if (applyTo === "all" || applyTo === undefined) {
        contextTargets = allResults;
      } else {
        const idx =
          typeof applyTo === "number"
            ? applyTo
            : parseInt(String(applyTo), 10);
        if (!isNaN(idx) && strategyResultArrays[idx]) {
          contextTargets = [...contextTargets, ...strategyResultArrays[idx]];
        } else {
          contextTargets = allResults;
        }
      }
    }

    // Deduplicate targets, limit to top 10 to bound API calls
    const uniqueTargets = new Map<string, UnifiedResult>();
    for (const r of contextTargets) {
      if (!uniqueTargets.has(r.chunk_id)) uniqueTargets.set(r.chunk_id, r);
    }
    const targets = [...uniqueTargets.values()].slice(0, 10);

    console.log(
      `[strategy-executor] Fetching surrounding context for ${targets.length} chunks`
    );

    const surroundingArrays = await Promise.all(
      targets.map((r) =>
        fetchSurroundingChunks(r.chunk_id, workspaceId, adminSupabase)
      )
    );
    allResults = [...allResults, ...surroundingArrays.flat()];
  }

  // Deduplicate by chunk_id (first occurrence wins)
  const seen = new Map<string, UnifiedResult>();
  for (const result of allResults) {
    if (!seen.has(result.chunk_id)) seen.set(result.chunk_id, result);
  }

  // Sort chronologically (nulls last)
  return [...seen.values()].sort((a, b) => {
    const tsA = a.msg_ts ? new Date(a.msg_ts).getTime() : Infinity;
    const tsB = b.msg_ts ? new Date(b.msg_ts).getTime() : Infinity;
    return tsA - tsB;
  });
}

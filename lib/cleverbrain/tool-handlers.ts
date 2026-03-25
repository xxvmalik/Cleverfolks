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

// ── browse_website ────────────────────────────────────────────────────────

/**
 * Fetch page content using Tavily Extract API (handles JS-rendered pages).
 */
async function fetchWithTavily(url: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        urls: [url],
        extract_depth: "advanced",
      }),
    });

    const data = (await response.json()) as {
      results?: Array<{ raw_content?: string; text?: string }>;
      failed_results?: Array<{ url: string; error: string }>;
    };

    console.log(
      `[browse_website:tavily] ${url}: ${data.results?.length ?? 0} results, ${data.failed_results?.length ?? 0} failed`
    );

    if (data.results && data.results.length > 0) {
      const content =
        data.results[0].raw_content || data.results[0].text || "";
      console.log(
        `[browse_website:tavily] Content length: ${content.length} chars`
      );
      return content;
    }

    return null;
  } catch (error) {
    console.error(`[browse_website:tavily] Error fetching ${url}:`, error);
    return null;
  }
}

/**
 * Fallback: direct HTTP fetch for static HTML pages.
 * Strips HTML tags to get text content.
 */
async function fetchDirect(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      console.log(
        `[browse_website:direct] ${url} returned ${response.status}`
      );
      return null;
    }

    const html = await response.text();

    // Strip HTML tags to get text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/(div|p|tr|li|h[1-6]|br|hr)[^>]*>/gi, "\n")
      .replace(/<(br|hr)[^>]*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x20A6;/g, "\u20A6")
      .replace(/&#8358;/g, "\u20A6")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();

    console.log(
      `[browse_website:direct] ${url}: ${html.length} chars HTML -> ${text.length} chars text`
    );
    return text;
  } catch (error) {
    console.error(`[browse_website:direct] Error fetching ${url}:`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleBrowseWebsite(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input } = ctx;
  const url = input.url as string;

  if (!url) {
    return { results: [], summary: "No URL provided." };
  }

  // Try Tavily Extract first (handles JS-rendered pages)
  let pageContent = await fetchWithTavily(url);

  // If Tavily returned very little content, try direct HTTP fetch as fallback
  if (!pageContent || pageContent.length < 1000) {
    console.log(
      `[browse_website] Tavily returned ${pageContent?.length ?? 0} chars -- trying direct fetch`
    );
    const directContent = await fetchDirect(url);
    if (directContent && directContent.length > (pageContent?.length ?? 0)) {
      pageContent = directContent;
      console.log(
        `[browse_website] Direct fetch got ${pageContent.length} chars`
      );
    }
  }

  if (!pageContent || pageContent.length < 100) {
    return {
      results: [],
      summary: `Could not extract meaningful content from ${url}. The page may require login, block automated access, or use heavy client-side rendering. Try a different page on the site.`,
    };
  }

  // Smart extraction: if page is large and we have a query, find relevant sections
  const query = input.query as string | undefined;
  let extractedContent: string;

  if (pageContent.length > 15000 && query) {
    extractedContent = extractRelevantSections(pageContent, query, 15000);
    console.log(
      `[browse_website] Smart extraction: ${pageContent.length} chars -> ${extractedContent.length} chars for query "${query}"`
    );
  } else if (pageContent.length > 15000) {
    extractedContent =
      pageContent.slice(0, 15000) +
      "\n\n[Content truncated -- page had more content. Tip: provide a query parameter to extract relevant sections from large pages.]";
    console.log(
      `[browse_website] Blind truncation: ${pageContent.length} -> 15000 chars (no query provided)`
    );
  } else {
    extractedContent = pageContent;
  }

  // If query is price-related and extracted content has no price patterns, force direct fetch
  if (query && isPriceQuery(query) && !hasPricePatterns(extractedContent)) {
    console.log(
      `[browse_website] Price query but no prices found in Tavily content -- forcing direct fetch`
    );
    const directContent = await fetchDirect(url);
    if (directContent && directContent.length > 500) {
      const directExtracted = extractRelevantSections(directContent, query, 15000);
      if (hasPricePatterns(directExtracted)) {
        console.log(
          `[browse_website] Direct fetch found prices! Using direct content (${directExtracted.length} chars)`
        );
        extractedContent = directExtracted;
      }
    }
  }

  console.log(
    `[browse_website] ${url} → ${pageContent.length} chars total, ${extractedContent.length} chars returned`
  );

  return {
    results: [],
    summary: `Content from ${url}:\n\n${extractedContent}`,
  };
}

/**
 * Extract sections of text that are most relevant to a query.
 * Splits content into chunks, scores each by keyword relevance,
 * and returns the highest-scoring chunks up to maxLength.
 */
function extractRelevantSections(
  content: string,
  query: string,
  maxLength: number
): string {
  // Build keyword list from query
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  // Split content into chunks by lines
  const lines = content.split("\n");
  const CHUNK_SIZE = 30;
  const chunks: Array<{ text: string; score: number; index: number }> = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunkLines = lines.slice(i, i + CHUNK_SIZE);
    const chunkText = chunkLines.join("\n").trim();
    if (chunkText.length < 20) continue;

    // Score by keyword matches
    const lowerChunk = chunkText.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, "gi");
      const matches = lowerChunk.match(regex);
      if (matches) score += matches.length;
    }

    // Bonus for price-like patterns (numbers with currency)
    if (
      /(?:\u20A6|NGN|naira|\$|USD)\s*[\d,]+/i.test(chunkText) ||
      /[\d,]+\s*(?:\u20A6|NGN|naira|\$|USD)/i.test(chunkText)
    ) {
      score += 3;
    }
    // Bonus for "per 1,000" or "per 1K" patterns (common in SMM)
    if (/per\s*(?:1[,.]?000|1k)/i.test(chunkText)) {
      score += 3;
    }

    chunks.push({ text: chunkText, score, index: i });
  }

  // Sort by score (highest first), then by position (earlier first for ties)
  chunks.sort((a, b) => b.score - a.score || a.index - b.index);

  // Take highest-scoring chunks until we hit maxLength
  const selectedChunks: Array<{ text: string; index: number }> = [];
  let totalLength = 0;

  for (const chunk of chunks) {
    if (chunk.score === 0) continue;
    if (totalLength + chunk.text.length > maxLength) {
      if (selectedChunks.length === 0) {
        selectedChunks.push({
          text: chunk.text.slice(0, maxLength),
          index: chunk.index,
        });
        totalLength = maxLength;
      }
      break;
    }
    selectedChunks.push({ text: chunk.text, index: chunk.index });
    totalLength += chunk.text.length;
  }

  // If no relevant chunks found, fall back to first maxLength chars
  if (selectedChunks.length === 0) {
    return (
      content.slice(0, maxLength) +
      "\n\n[No sections matched the query. Showing beginning of page.]"
    );
  }

  // Sort selected chunks back into document order for readability
  selectedChunks.sort((a, b) => a.index - b.index);

  return (
    selectedChunks.map((c) => c.text).join("\n\n---\n\n") +
    `\n\n[Extracted ${selectedChunks.length} relevant sections from ${content.length.toLocaleString()} character page]`
  );
}

/**
 * Check if a query is asking about prices, costs, rates, or similar.
 */
function isPriceQuery(query: string): boolean {
  const priceTerms =
    /price|pricing|cost|rate|charge|fee|cheap|expensive|afford|\u20A6|NGN|naira|\$|USD|how much|per 1k|per 1,000/i;
  return priceTerms.test(query);
}

/**
 * Check if content contains price-like patterns.
 */
function hasPricePatterns(content: string): boolean {
  const patterns = [
    /(?:\u20A6|NGN|naira)\s*[\d,]+(?:\.\d{1,2})?/i,
    /[\d,]+(?:\.\d{1,2})?\s*(?:\u20A6|NGN|naira)/i,
    /(?:\$|USD)\s*[\d,]+(?:\.\d{1,2})?/i,
    /[\d,]+(?:\.\d{1,2})?\s*(?:\$|USD)/i,
    /NGN\s+\d/i,
  ];
  return patterns.some((p) => p.test(content));
}

// ── map_website ──────────────────────────────────────────────────────────

export async function handleMapWebsite(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input } = ctx;
  const url = input.url as string;

  if (!url) {
    return { results: [], summary: "No URL provided." };
  }

  try {
    const response = await fetch("https://api.tavily.com/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        url,
        max_depth: 1,
        limit: 30,
      }),
    });

    const data = (await response.json()) as {
      results?: string[];
    };

    if (data.results && data.results.length > 0) {
      const urlList = data.results.join("\n");
      console.log(
        `[tool-handler] map_website: ${url} → ${data.results.length} pages`
      );
      return {
        results: [],
        summary: `Pages found on ${url}:\n\n${urlList}\n\nUse browse_website to read the content of any of these pages.`,
      };
    }

    return {
      results: [],
      summary: `Could not map ${url}. The site may block crawlers.`,
    };
  } catch (error) {
    console.error("[tool-handler] map_website error:", error);
    return {
      results: [],
      summary: `Failed to map ${url}. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ── query_sales_pipeline ──────────────────────────────────────────────────────

async function handleQuerySalesPipeline(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const stage = input.stage as string | undefined;
  const resolution = input.resolution as string | undefined;
  const search = input.search as string | undefined;
  const after = input.after as string | undefined;
  const before = input.before as string | undefined;
  const limit = Math.min(Number(input.limit ?? 20), 100);

  let query = adminSupabase
    .from("skyler_sales_pipeline")
    .select(
      "id, contact_name, contact_email, company_name, stage, resolution, " +
      "lead_score, health_score, deal_value, emails_sent, emails_replied, " +
      "awaiting_reply, cadence_step, last_email_sent_at, last_reply_at, " +
      "created_at, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (stage) query = query.eq("stage", stage);
  if (resolution && resolution !== "null") {
    query = query.eq("resolution", resolution);
  }
  if (search) {
    query = query.or(
      `contact_name.ilike.%${search}%,contact_email.ilike.%${search}%,company_name.ilike.%${search}%`
    );
  }
  if (after) query = query.gte("created_at", after);
  if (before) query = query.lte("created_at", before);

  const { data, error } = await query;

  if (error) {
    console.error("[tool-handler] query_sales_pipeline error:", error.message);
    return { results: [], summary: "Failed to query pipeline" };
  }

  const leads = (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (leads.length === 0) {
    return { results: [], summary: "No leads found matching the criteria." };
  }

  const stageCounts: Record<string, number> = {};
  let totalValue = 0;
  for (const lead of leads) {
    const s = (lead.stage as string) ?? "unknown";
    stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    totalValue += Number(lead.deal_value ?? 0);
  }

  const stageBreakdown = Object.entries(stageCounts)
    .map(([s, c]) => `${s}: ${c}`)
    .join(", ");

  const summary =
    `Found ${leads.length} leads. Stages: ${stageBreakdown}. ` +
    `Total pipeline value: ${totalValue > 0 ? totalValue.toLocaleString() : "not set"}.\n` +
    leads
      .map(
        (l) =>
          `- ${l.contact_name} (${l.contact_email}) at ${l.company_name ?? "—"} | ` +
          `Stage: ${l.stage} | Score: ${l.lead_score ?? "—"} | Health: ${l.health_score ?? "—"} | ` +
          `Value: ${l.deal_value ?? "—"} | Emails: ${l.emails_sent ?? 0} sent, ${l.emails_replied ?? 0} replied | ` +
          `Last: ${l.updated_at ? new Date(l.updated_at as string).toLocaleDateString("en-GB") : "—"}`
      )
      .join("\n");

  return { results: [], summary };
}

// ── get_lead_details ────────────────────────────────────────────────────────

async function handleGetLeadDetails(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const leadId = input.lead_id as string | undefined;
  const contactEmail = input.contact_email as string | undefined;

  if (!leadId && !contactEmail) {
    return { results: [], summary: "Please provide either a lead_id or contact_email." };
  }

  let pipelineQuery = adminSupabase
    .from("skyler_sales_pipeline")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (leadId) {
    pipelineQuery = pipelineQuery.eq("id", leadId);
  } else {
    pipelineQuery = pipelineQuery.ilike("contact_email", contactEmail!);
  }

  const { data: pipeline } = await pipelineQuery.maybeSingle();

  if (!pipeline) {
    return { results: [], summary: `No lead found for ${leadId ?? contactEmail}.` };
  }

  const pid = pipeline.id as string;

  // Fetch related data in parallel
  const [eventsResult, decisionsResult, actionsResult] = await Promise.all([
    adminSupabase
      .from("pipeline_events")
      .select("event_type, from_stage, to_stage, source, source_detail, payload, created_at")
      .eq("lead_id", pid)
      .order("created_at", { ascending: false })
      .limit(15),
    adminSupabase
      .from("skyler_decisions")
      .select("event_type, decision, guardrail_outcome, created_at")
      .eq("pipeline_id", pid)
      .order("created_at", { ascending: false })
      .limit(10),
    adminSupabase
      .from("skyler_actions")
      .select("tool_name, description, status, created_at")
      .eq("workspace_id", workspaceId)
      .or(`pipeline_id.eq.${pid},tool_input->>pipelineId.eq.${pid}`)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const events = eventsResult.data ?? [];
  const decisions = decisionsResult.data ?? [];
  const actions = actionsResult.data ?? [];

  const thread = (pipeline.conversation_thread ?? []) as Array<Record<string, unknown>>;
  const threadSummary = thread.length > 0
    ? thread.slice(-6).map((e) =>
        `[${e.role}] (${e.timestamp ? new Date(e.timestamp as string).toLocaleDateString("en-GB") : "—"}): ${(e.content as string ?? "").slice(0, 150)}${(e.content as string ?? "").length > 150 ? "..." : ""}`
      ).join("\n")
    : "No conversation yet.";

  const eventsSummary = events.length > 0
    ? events.slice(0, 8).map((e) =>
        `${new Date(e.created_at as string).toLocaleDateString("en-GB")} — ${e.event_type}${e.from_stage ? ` (${e.from_stage} → ${e.to_stage})` : ""}${e.source_detail ? `: ${e.source_detail}` : ""}`
      ).join("\n")
    : "No events.";

  const decisionsSummary = decisions.length > 0
    ? decisions.slice(0, 5).map((d) => {
        const dec = d.decision as Record<string, unknown>;
        return `${new Date(d.created_at as string).toLocaleDateString("en-GB")} — ${dec.action_type} (${d.guardrail_outcome}): ${(dec.reasoning as string ?? "").slice(0, 100)}`;
      }).join("\n")
    : "No decisions.";

  const skylerNote = pipeline.skyler_note as Record<string, unknown> | null;

  const summary =
    `## Lead: ${pipeline.contact_name} (${pipeline.contact_email})\n` +
    `Company: ${pipeline.company_name ?? "—"}\n` +
    `Stage: ${pipeline.stage} | Resolution: ${pipeline.resolution ?? "active"}\n` +
    `Lead Score: ${pipeline.lead_score ?? "—"} | Health: ${pipeline.health_score ?? "—"} | Deal Value: ${pipeline.deal_value ?? "—"}\n` +
    `Emails: ${pipeline.emails_sent ?? 0} sent, ${pipeline.emails_replied ?? 0} replied | Cadence Step: ${pipeline.cadence_step ?? 0}\n` +
    `Awaiting Reply: ${pipeline.awaiting_reply ? "yes" : "no"} | Next Follow-up: ${pipeline.next_followup_at ? new Date(pipeline.next_followup_at as string).toLocaleDateString("en-GB") : "none"}\n` +
    `Created: ${new Date(pipeline.created_at as string).toLocaleDateString("en-GB")} | Updated: ${new Date(pipeline.updated_at as string).toLocaleDateString("en-GB")}\n` +
    (skylerNote && !(skylerNote.resolved) ? `\nSkyler Note: ${skylerNote.message}\n` : "") +
    `\n### Recent Conversation (last ${Math.min(6, thread.length)} of ${thread.length})\n${threadSummary}\n` +
    `\n### Activity Timeline (${events.length} events)\n${eventsSummary}\n` +
    `\n### Skyler Decisions (${decisions.length} total)\n${decisionsSummary}\n` +
    `\n### Actions (${actions.length} total)\n` +
    (actions.length > 0
      ? actions.slice(0, 5).map((a) =>
          `${new Date(a.created_at as string).toLocaleDateString("en-GB")} — ${a.tool_name}: ${a.description ?? "—"} [${a.status}]`
        ).join("\n")
      : "No actions.");

  return { results: [], summary };
}

// ── get_agent_activity ──────────────────────────────────────────────────────

async function handleGetAgentActivity(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const agentType = input.agent_type as string | undefined;
  const activityType = input.activity_type as string | undefined;
  const after = (input.after as string) ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const before = input.before as string | undefined;
  const limit = Math.min(Number(input.limit ?? 30), 100);

  let query = adminSupabase
    .from("agent_activities")
    .select("agent_type, activity_type, title, description, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", after)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (agentType) query = query.eq("agent_type", agentType);
  if (activityType) query = query.eq("activity_type", activityType);
  if (before) query = query.lte("created_at", before);

  const { data, error } = await query;

  if (error) {
    console.error("[tool-handler] get_agent_activity error:", error.message);
    return { results: [], summary: "Failed to query agent activity." };
  }

  const activities = data ?? [];

  if (activities.length === 0) {
    return { results: [], summary: "No agent activity found in the specified period." };
  }

  const grouped: Record<string, number> = {};
  for (const a of activities) {
    const t = a.activity_type as string;
    grouped[t] = (grouped[t] ?? 0) + 1;
  }

  const groupedSummary = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type.replace(/_/g, " ")}: ${count}`)
    .join(", ");

  const summary =
    `${activities.length} activities in period. Breakdown: ${groupedSummary}.\n\nRecent activity:\n` +
    activities.slice(0, 15).map((a) =>
      `${new Date(a.created_at as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — [${a.agent_type}] ${a.title}${a.description ? ` — ${(a.description as string).slice(0, 100)}` : ""}`
    ).join("\n");

  return { results: [], summary };
}

// ── pipeline_metrics ────────────────────────────────────────────────────────

function getDateRange(period?: string, after?: string, before?: string): { start: string | null; end: string | null } {
  if (after || before) return { start: after ?? null, end: before ?? null };

  const now = new Date();
  switch (period) {
    case "this_week": {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      return { start: monday.toISOString(), end: now.toISOString() };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    case "this_quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qMonth, 1);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "last_quarter": {
      const curQ = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), (curQ - 1) * 3, 1);
      const end = new Date(now.getFullYear(), curQ * 3, 0, 23, 59, 59);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    default:
      return { start: null, end: null };
  }
}

async function handlePipelineMetrics(
  ctx: ToolContext
): Promise<ToolHandlerResult> {
  const { input, workspaceId, adminSupabase } = ctx;
  const period = input.period as string | undefined;
  const { start, end } = getDateRange(period, input.after as string, input.before as string);

  let query = adminSupabase
    .from("skyler_sales_pipeline")
    .select(
      "id, stage, resolution, deal_value, emails_sent, emails_replied, " +
      "emails_opened, health_score, created_at, updated_at, resolved_at"
    )
    .eq("workspace_id", workspaceId);

  if (start) query = query.gte("created_at", start);
  if (end) query = query.lte("created_at", end);

  const { data, error } = await query;

  if (error) {
    console.error("[tool-handler] pipeline_metrics error:", error.message);
    return { results: [], summary: "Failed to query pipeline metrics." };
  }

  const leads = (data ?? []) as unknown as Array<Record<string, unknown>>;

  if (leads.length === 0) {
    return { results: [], summary: "No pipeline data found for the specified period." };
  }

  const totalLeads = leads.length;
  const stageCounts: Record<string, number> = {};
  let totalValue = 0;
  let leadsWithValue = 0;
  let totalEmailsSent = 0;
  let totalEmailsReplied = 0;
  let totalEmailsOpened = 0;
  let closedWon = 0;
  let closedLost = 0;
  let meetingsBooked = 0;
  let demosBooked = 0;

  for (const lead of leads) {
    const s = (lead.stage as string) ?? "unknown";
    stageCounts[s] = (stageCounts[s] ?? 0) + 1;

    const val = Number(lead.deal_value ?? 0);
    if (val > 0) { totalValue += val; leadsWithValue++; }

    totalEmailsSent += Number(lead.emails_sent ?? 0);
    totalEmailsReplied += Number(lead.emails_replied ?? 0);
    totalEmailsOpened += Number(lead.emails_opened ?? 0);

    const res = lead.resolution as string | null;
    if (res === "won" || s === "closed_won") closedWon++;
    if (res === "lost" || res === "disqualified" || s === "disqualified") closedLost++;
    if (res === "meeting_booked" || s === "demo_booked") meetingsBooked++;
    if (res === "demo_booked") demosBooked++;
  }

  const avgDealSize = leadsWithValue > 0 ? Math.round(totalValue / leadsWithValue) : 0;
  const replyRate = totalEmailsSent > 0 ? Math.round((totalEmailsReplied / totalEmailsSent) * 100) : 0;
  const openRate = totalEmailsSent > 0 ? Math.round((totalEmailsOpened / totalEmailsSent) * 100) : 0;
  const winRate = (closedWon + closedLost) > 0 ? Math.round((closedWon / (closedWon + closedLost)) * 100) : 0;

  const stageBreakdown = Object.entries(stageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s.replace(/_/g, " ")}: ${c}`)
    .join("\n  ");

  const periodLabel = period ? period.replace(/_/g, " ") : (start ? `${start.slice(0, 10)} to ${(end ?? "now").slice(0, 10)}` : "all time");

  const summary =
    `## Pipeline Metrics (${periodLabel})\n\n` +
    `**Overview:**\n` +
    `- Total leads: ${totalLeads}\n` +
    `- Total pipeline value: ${totalValue > 0 ? totalValue.toLocaleString() : "not tracked"}\n` +
    `- Average deal size: ${avgDealSize > 0 ? avgDealSize.toLocaleString() : "not tracked"}\n\n` +
    `**By Stage:**\n  ${stageBreakdown}\n\n` +
    `**Email Performance:**\n` +
    `- Emails sent: ${totalEmailsSent}\n` +
    `- Open rate: ${openRate}%\n` +
    `- Reply rate: ${replyRate}%\n` +
    `- Total replies: ${totalEmailsReplied}\n\n` +
    `**Outcomes:**\n` +
    `- Deals won: ${closedWon}\n` +
    `- Deals lost/disqualified: ${closedLost}\n` +
    `- Win rate: ${winRate}%\n` +
    `- Meetings booked: ${meetingsBooked}\n` +
    `- Demos booked: ${demosBooked}`;

  return { results: [], summary };
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
  browse_website: handleBrowseWebsite,
  map_website: handleMapWebsite,
  query_sales_pipeline: handleQuerySalesPipeline,
  get_lead_details: handleGetLeadDetails,
  get_agent_activity: handleGetAgentActivity,
  pipeline_metrics: handlePipelineMetrics,
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

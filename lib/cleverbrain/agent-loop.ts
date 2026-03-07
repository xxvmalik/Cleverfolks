import Anthropic from "@anthropic-ai/sdk";
import { CLEVERBRAIN_TOOLS } from "./tools";
import { executeToolCall, type ToolHandlerResult } from "./tool-handlers";
import type { UnifiedResult } from "@/lib/strategy-executor";
import type { WebResult } from "@/lib/web-search";
import type { IntegrationInfo } from "@/lib/integrations-manifest";
import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

export type SSEEvent =
  | { type: "activity"; action: string }
  | { type: "text"; text: string };

export type AgentLoopParams = {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt: string;
  workspaceId: string;
  adminSupabase: AdminDb;
  integrationManifest: IntegrationInfo[];
};

export type AgentLoopResult = {
  fullResponse: string;
  allResults: UnifiedResult[];
  webResults: WebResult[];
};

// ── Activity label generation ─────────────────────────────────────────────────

function generateActivityLabel(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "search_knowledge_base":
      return "Searching your business data...";
    case "fetch_recent_messages": {
      const after = input.after as string | undefined;
      const before = input.before as string | undefined;
      if (after || before) {
        const parts: string[] = [];
        if (after) {
          try {
            parts.push(
              new Date(after).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            );
          } catch {
            parts.push("start");
          }
        }
        if (before) {
          try {
            parts.push(
              new Date(before).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            );
          } catch {
            parts.push("now");
          }
        }
        return `Fetching messages from ${parts.join(" – ")}...`;
      }
      return "Fetching recent messages...";
    }
    case "count_messages_by_person":
      return "Counting messages across channels...";
    case "search_by_person": {
      const name = input.person_name as string | undefined;
      return name
        ? `Searching ${name}'s messages...`
        : "Searching by person...";
    }
    case "search_web":
      return "Searching the web...";
    case "browse_website": {
      const browseUrl = input.url as string | undefined;
      try {
        return browseUrl
          ? `Reading ${new URL(browseUrl).hostname}...`
          : "Reading webpage...";
      } catch {
        return "Reading webpage...";
      }
    }
    case "map_website": {
      const mapUrl = input.url as string | undefined;
      try {
        return mapUrl
          ? `Mapping ${new URL(mapUrl).hostname}...`
          : "Mapping website...";
      } catch {
        return "Mapping website...";
      }
    }
    default:
      return "Processing...";
  }
}

// ── Tool result formatting ────────────────────────────────────────────────────

function getChannelName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (
    sourceType === "slack_message" ||
    sourceType === "slack_reply" ||
    sourceType === "slack_reaction"
  ) {
    const name =
      (meta.channel_name as string | undefined) ??
      (meta.channel_id as string | undefined) ??
      "";
    return name ? `#${name}` : "";
  }
  if (sourceType === "gmail_message") {
    const subject = (meta.subject as string | undefined) ?? "";
    return subject ? `📧 ${subject.slice(0, 60)}` : "📧 Gmail";
  }
  if (sourceType.startsWith("hubspot_")) {
    const label = sourceType.replace("hubspot_", "").replace(/^\w/, (c) => c.toUpperCase());
    return `HubSpot ${label}`;
  }
  return "";
}

function getUserName(
  sourceType: string,
  meta: Record<string, unknown>
): string {
  if (sourceType === "slack_message" || sourceType === "slack_reply") {
    return (
      (meta.user_name as string | undefined) ??
      (meta.user as string | undefined) ??
      ""
    );
  }
  if (sourceType === "gmail_message") {
    return (
      (meta.user_name as string | undefined) ??
      (meta.sender_name as string | undefined) ??
      (meta.from as string | undefined) ??
      ""
    );
  }
  if (sourceType === "email") {
    return (meta.from as string | undefined) ?? "";
  }
  if (sourceType === "hubspot_contact") {
    return (meta.name as string | undefined) ?? "";
  }
  if (sourceType === "hubspot_company") {
    return (meta.name as string | undefined) ?? "";
  }
  return "";
}

function formatSourceDate(meta: Record<string, unknown>): string {
  const raw =
    (meta.date as string | undefined) ??
    (meta.ts as string | undefined) ??
    (meta.start as string | undefined) ??
    (meta.modified_time as string | undefined) ??
    (meta.close_date as string | undefined);
  if (!raw) return "";
  try {
    const asFloat = parseFloat(raw);
    const d =
      !isNaN(asFloat) && asFloat > 1_000_000_000
        ? new Date(asFloat * 1000)
        : new Date(raw);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * For HubSpot deal records, pre-calculate date differences so Claude
 * doesn't have to do date math (which LLMs do unreliably).
 */
function enrichDealDates(r: UnifiedResult): UnifiedResult {
  if (r.source_type !== "hubspot_deal") return r;

  const text = r.chunk_text ?? "";
  const meta = r.metadata ?? {};

  // Extract close date from chunk_text or metadata
  const closeDateMatch = text.match(/Close Date:\s*(\S+)/i);
  const closeDateStr =
    closeDateMatch?.[1] ?? (meta.close_date as string | undefined);
  if (!closeDateStr) return r;

  const closeDate = new Date(closeDateStr);
  if (isNaN(closeDate.getTime())) return r;

  const now = new Date();
  const diffMs = closeDate.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Determine if deal is closed from chunk_text
  const isClosed = /Status:\s*Closed/i.test(text);

  let dateSuffix: string;
  if (isClosed) {
    dateSuffix = "| Closed";
  } else if (diffDays > 0) {
    dateSuffix = `| Due: in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  } else if (diffDays === 0) {
    dateSuffix = "| Due: today";
  } else {
    const overdue = Math.abs(diffDays);
    dateSuffix = `| OVERDUE: ${overdue} day${overdue === 1 ? "" : "s"} past due`;
  }

  return {
    ...r,
    chunk_text: `${text}\n${dateSuffix}`,
  };
}

function formatUnifiedResult(r: UnifiedResult): string {
  const enriched = enrichDealDates(r);
  const meta = enriched.metadata ?? {};
  const srcParts: string[] = [enriched.source_type];
  const ch = getChannelName(enriched.source_type, meta);
  if (ch) srcParts.push(ch);
  const usr = getUserName(enriched.source_type, meta);
  if (usr) srcParts.push(usr);
  const dt = formatSourceDate(meta);
  if (dt) srcParts.push(dt);
  if (enriched.match_type === "mentioned") srcParts.push("person_mentioned_not_author");
  return `[Source: ${srcParts.join(" | ")}]\n${enriched.chunk_text}`;
}

function formatToolResultForClaude(
  toolName: string,
  handlerResult: ToolHandlerResult
): string {
  if (toolName === "browse_website" || toolName === "map_website") {
    return handlerResult.summary;
  }

  if (toolName === "search_web") {
    const webResults = handlerResult.results as WebResult[];
    if (webResults.length === 0) return "No web results found.";
    return webResults
      .map((r) => `[Source: ${r.title} | ${r.url}]\n${r.content}`)
      .join("\n\n---\n\n");
  }

  const results = handlerResult.results as UnifiedResult[];
  if (results.length === 0) return handlerResult.summary;

  // For count results, put counts first then sample messages
  const countResults = results.filter(
    (r) => r.source_type === "aggregation_counts"
  );
  const regularResults = results.filter(
    (r) => r.source_type !== "aggregation_counts"
  );

  const parts: string[] = [];

  if (countResults.length > 0) {
    parts.push(countResults.map((r) => r.chunk_text).join("\n\n"));
  }

  if (regularResults.length > 0) {
    const header =
      countResults.length > 0
        ? `MESSAGE SAMPLE (${regularResults.length} messages — qualitative context):\n`
        : "";
    parts.push(
      header + regularResults.map(formatUnifiedResult).join("\n\n---\n\n")
    );
  }

  // Append record count summary so Claude can see the exact total
  if (regularResults.length > 0) {
    // Group by source_type for per-type counts
    const typeCounts: Record<string, number> = {};
    for (const r of regularResults) {
      const st = r.source_type ?? "unknown";
      typeCounts[st] = (typeCounts[st] ?? 0) + 1;
    }
    const countLines = Object.entries(typeCounts)
      .map(([type, count]) => `  ${type}: ${count}`)
      .join("\n");
    parts.push(`\n---\nTOTAL RECORDS RETURNED: ${regularResults.length}\nBREAKDOWN BY TYPE:\n${countLines}`);
  }

  return parts.join("\n\n===\n\n");
}

// ── Agent loop ────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

export async function runAgentLoop(
  params: AgentLoopParams,
  onEvent: (event: SSEEvent) => void
): Promise<AgentLoopResult> {
  const {
    message,
    history,
    systemPrompt,
    workspaceId,
    adminSupabase,
  } = params;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Accumulate all results across tool calls for source extraction
  const allResults: UnifiedResult[] = [];
  const webResults: WebResult[] = [];

  // Build the messages array
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: message },
  ];

  let iterations = 0;

  // ── Tool loop: non-streaming iterations ───────────────────────────────
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: CLEVERBRAIN_TOOLS,
      messages,
    });

    // Check if response contains tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
        b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — this is the final text response.
      // Extract and stream the text.
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const fullText = textBlocks.map((b) => b.text).join("");

      // Stream the final response with tag buffering for [ROLE_UPDATE:]
      onEvent({ type: "activity", action: "Generating response..." });
      streamTextWithTagBuffering(fullText, onEvent);

      return { fullResponse: fullText, allResults, webResults };
    }

    // ── Execute tool calls ──────────────────────────────────────────────
    // Append the assistant's response (with tool_use blocks) to messages
    messages.push({ role: "assistant", content: response.content });

    // Build tool_result messages
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolInput = toolUse.input as Record<string, unknown>;
      const activityLabel = generateActivityLabel(toolUse.name, toolInput);
      onEvent({ type: "activity", action: activityLabel });

      console.log(
        `[agent-loop] calling tool: ${toolUse.name} input=${JSON.stringify(toolInput).slice(0, 200)}`
      );

      const handlerResult = await executeToolCall(
        toolUse.name,
        toolInput,
        workspaceId,
        adminSupabase
      );

      // Accumulate results
      if (toolUse.name === "search_web") {
        webResults.push(...(handlerResult.results as WebResult[]));
      } else {
        allResults.push(...(handlerResult.results as UnifiedResult[]));
      }

      // Format result as text for Claude
      const formattedResult = formatToolResultForClaude(
        toolUse.name,
        handlerResult
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: formattedResult,
      });
    }

    // Append tool results to messages
    messages.push({ role: "user", content: toolResults });

    // Log results summary
    const totalResults = allResults.length + webResults.length;
    console.log(
      `[agent-loop] iteration ${iterations}: ${toolUseBlocks.length} tool calls, ` +
        `${totalResults} total results accumulated`
    );

    // If Claude indicated stop_reason is "end_turn" with tool_use, it means
    // it wants to see the results before continuing — loop back.
  }

  // Safety: max iterations exceeded — generate response with what we have
  console.warn(
    `[agent-loop] max iterations (${MAX_ITERATIONS}) reached — forcing final response`
  );

  // Make one final call without tools to force a text response
  const finalResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  const textBlocks = finalResponse.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const fullText = textBlocks.map((b) => b.text).join("");

  onEvent({ type: "activity", action: "Generating response..." });
  streamTextWithTagBuffering(fullText, onEvent);

  return { fullResponse: fullText, allResults, webResults };
}

// ── Tag-buffered streaming ────────────────────────────────────────────────────

/**
 * Streams text to the frontend, buffering to catch and suppress [ROLE_UPDATE:] tags.
 * Since the final response is already complete (non-streaming tool loop), we can
 * detect the tag and strip it before sending.
 */
function streamTextWithTagBuffering(
  text: string,
  onEvent: (event: SSEEvent) => void
): void {
  // Strip any [ROLE_UPDATE:...] tags before streaming
  const cleanText = text.replace(/\[ROLE_UPDATE:[^\]]*\]/gi, "").trimEnd();

  // Send in chunks to simulate streaming (better UX than one giant block)
  const CHUNK_SIZE = 50;
  for (let i = 0; i < cleanText.length; i += CHUNK_SIZE) {
    const chunk = cleanText.slice(i, i + CHUNK_SIZE);
    onEvent({ type: "text", text: chunk });
  }
}

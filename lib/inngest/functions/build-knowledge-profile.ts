import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Types ─────────────────────────────────────────────────────────────────────

type SerialisableChunk = {
  chunk_text: string;
  metadata: Record<string, unknown>;
  source_type: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const FETCH_PAGE_SIZE = 200;
const ANALYSIS_BATCH_SIZE = 200;
/** Cap total chunks so a single workspace can't generate unbounded API spend. */
const MAX_CHUNKS = 600;

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function formatChunksForAnalysis(chunks: SerialisableChunk[]): string {
  return chunks
    .map((c) => {
      const meta = c.metadata ?? {};
      const channelName =
        (meta.channel_name as string | undefined) ??
        (meta.channel_id as string | undefined) ??
        "";
      const userName =
        (meta.user_name as string | undefined) ??
        (meta.user as string | undefined) ??
        "";
      const tsRaw = meta.ts as string | undefined;
      const date = tsRaw
        ? new Date(parseFloat(tsRaw) * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";

      const parts: string[] = [c.source_type];
      if (channelName) parts.push(`#${channelName}`);
      if (userName) parts.push(userName);
      if (date) parts.push(date);

      return `[${parts.join(" | ")}]\n${c.chunk_text}`;
    })
    .join("\n\n---\n\n");
}

function buildAnalysisPrompt(formattedChunks: string, count: number): string {
  return `You are analyzing business communication data to build a company knowledge profile.

Analyze these ${count} messages and extract structured information.
Return ONLY a valid JSON object (no markdown, no code blocks, no explanation) with this exact structure:

{
  "team_members": [
    {
      "name": "string",
      "likely_role": "string — inferred from behavior, not job title",
      "active_channels": ["string"],
      "typical_activities": "string — what they actually do in messages",
      "notes": "string — anything notable like 'frequently tagged for escalations'"
    }
  ],
  "channels": [
    {
      "name": "string — without the # symbol",
      "purpose": "string — what this channel is actually used for",
      "typical_content": "string — types of messages posted here",
      "key_people": ["string — names of frequent posters"]
    }
  ],
  "business_patterns": [
    "string — recurring patterns like shift rotations, escalation flows, weekly syncs"
  ],
  "terminology": {
    "term": "definition — company-specific jargon or shorthand from the messages"
  },
  "key_topics": [
    "string — major ongoing themes or subjects across the workspace"
  ]
}

Rules:
- Base everything ONLY on what is observed in the messages — do not fabricate
- Infer roles from what people DO (posts announcements, handles complaints, shares designs)
- If someone is tagged for escalations or issues, note that specifically
- If a term has a specific meaning in this company's context, capture it
- team_members should only include real people found in the messages (not bots or integrations)
- Return the JSON object only — nothing before or after it

Messages:
${formattedChunks}`;
}

function buildMergePrompt(batchResults: unknown[]): string {
  const serialised = batchResults
    .map((r, i) => `--- Analysis ${i + 1} ---\n${JSON.stringify(r, null, 2)}`)
    .join("\n\n");
  return `Merge these ${batchResults.length} partial company profile analyses into a single comprehensive profile.

Combine duplicate entries (same person, same channel) by merging their details.
Resolve conflicts by preferring the most specific / most evidence-backed description.
Deduplicate business_patterns, key_topics, and terminology entries.
Return ONLY the merged JSON object (same structure, no markdown, no explanation).

Partial results:
${serialised}`;
}

/** Extract a JSON object from a Claude response that may contain markdown fences. */
function extractJSON(text: string): Record<string, unknown> | null {
  // 1. Direct parse
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  // 2. JSON inside ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  // 3. First { ... } block in the string
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) {
    try {
      return JSON.parse(raw[0]) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const buildKnowledgeProfileFunction = inngest.createFunction(
  {
    id: "build-knowledge-profile",
    name: "Build Knowledge Profile",
    retries: 1,
  },
  { event: "knowledge/profile.build" },
  async ({ event, step }) => {
    const { workspaceId } = event.data as { workspaceId: string };

    console.log(`[knowledge-profile] Starting build for workspace ${workspaceId}`);

    try {
      // ── Step 1: Set status to 'building' ────────────────────────────────────
      await step.run("set-status-building", async () => {
        const db = createAdminSupabaseClient();
        const { error } = await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: {},
          p_status: "building",
        });
        if (error) throw new Error(`Failed to set building status: ${error.message}`);
      });

      // ── Step 2: Fetch all chunks (paginated, capped at MAX_CHUNKS) ───────────
      const allChunks: SerialisableChunk[] = await step.run(
        "fetch-all-chunks",
        async () => {
          const db = createAdminSupabaseClient();
          const chunks: SerialisableChunk[] = [];
          let offset = 0;

          for (;;) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (db as any)
              .from("document_chunks")
              .select("chunk_text, metadata, synced_documents!inner(source_type)")
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false })
              .range(offset, offset + FETCH_PAGE_SIZE - 1);

            if (error) {
              console.error("[knowledge-profile] Fetch error:", error.message);
              break;
            }
            if (!data?.length) break;

            for (const row of data as Record<string, unknown>[]) {
              const doc = Array.isArray(row.synced_documents)
                ? (row.synced_documents[0] as Record<string, unknown> | undefined)
                : (row.synced_documents as Record<string, unknown> | null);
              chunks.push({
                chunk_text: row.chunk_text as string,
                metadata: (row.metadata as Record<string, unknown>) ?? {},
                source_type: (doc?.source_type as string) ?? "unknown",
              });
            }

            if (chunks.length >= MAX_CHUNKS || data.length < FETCH_PAGE_SIZE) break;
            offset += FETCH_PAGE_SIZE;
          }

          console.log(
            `[knowledge-profile] Fetched ${chunks.length} chunks for workspace ${workspaceId}`
          );
          return chunks;
        }
      );

      // Nothing to analyse — save an empty profile and exit
      if (allChunks.length === 0) {
        await step.run("save-empty-profile", async () => {
          const db = createAdminSupabaseClient();
          await db.rpc("upsert_knowledge_profile", {
            p_workspace_id: workspaceId,
            p_profile: {},
            p_status: "ready",
          });
        });
        console.log("[knowledge-profile] No chunks found — empty profile saved");
        return { status: "ready", chunks: 0, batches: 0 };
      }

      // ── Step 3: Analyse in batches of ANALYSIS_BATCH_SIZE ──────────────────
      const batches = chunkArray(allChunks, ANALYSIS_BATCH_SIZE);
      const batchResults: Record<string, unknown>[] = [];

      for (let i = 0; i < batches.length; i++) {
        const result = await step.run(`analyze-batch-${i + 1}`, async () => {
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const formatted = formatChunksForAnalysis(batches[i]);
          const prompt = buildAnalysisPrompt(formatted, batches[i].length);

          console.log(
            `[knowledge-profile] Analysing batch ${i + 1}/${batches.length} ` +
              `(${batches[i].length} chunks)`
          );

          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }],
          });

          const text =
            response.content[0]?.type === "text" ? response.content[0].text : "";
          const parsed = extractJSON(text);
          if (!parsed) {
            console.error(
              `[knowledge-profile] Batch ${i + 1}: failed to parse JSON response`
            );
          }
          return parsed ?? {};
        });
        batchResults.push(result as Record<string, unknown>);
      }

      // ── Step 4: Merge batches (skip if only one) ────────────────────────────
      const finalProfile =
        batches.length === 1
          ? batchResults[0]
          : await step.run("merge-batches", async () => {
              const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
              const prompt = buildMergePrompt(batchResults);

              console.log(
                `[knowledge-profile] Merging ${batchResults.length} batch results`
              );

              const response = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 4096,
                messages: [{ role: "user", content: prompt }],
              });

              const text =
                response.content[0]?.type === "text"
                  ? response.content[0].text
                  : "";
              return (extractJSON(text) ?? batchResults[0]) as Record<
                string,
                unknown
              >;
            });

      // ── Step 5: Save the finished profile ──────────────────────────────────
      await step.run("save-profile", async () => {
        const db = createAdminSupabaseClient();
        const { error } = await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: finalProfile,
          p_status: "ready",
        });
        if (error) throw new Error(`Failed to save profile: ${error.message}`);
        console.log(
          `[knowledge-profile] Profile saved — workspace ${workspaceId}`
        );
      });

      return {
        status: "ready",
        chunks: allChunks.length,
        batches: batches.length,
      };
    } catch (err) {
      console.error("[knowledge-profile] Build failed:", err);
      // Best-effort status update — not a step, runs even on retry
      try {
        const db = createAdminSupabaseClient();
        await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: {},
          p_status: "error",
        });
      } catch (dbErr) {
        console.error("[knowledge-profile] Failed to set error status:", dbErr);
      }
      throw err; // re-throw so Inngest records the failure
    }
  }
);

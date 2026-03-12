import type { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createEmbedding } from "@/lib/embeddings";
import type { ExtractedMemory } from "./memory-extractor";

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

export interface StoredMemory {
  id: string;
  scope: string;
  type: string;
  content: string;
  confidence: string;
  times_reinforced: number;
  last_used_at: string;
  created_at: string;
  similarity?: number;
}

/**
 * Search for similar existing memories (for conflict detection).
 */
async function findSimilarMemories(
  adminSupabase: AdminDb,
  workspaceId: string,
  embedding: number[],
  limit: number = 5
): Promise<StoredMemory[]> {
  const { data, error } = await adminSupabase.rpc("search_workspace_memories", {
    p_workspace_id: workspaceId,
    p_query_embedding: `[${embedding.join(",")}]`,
    p_limit: limit,
  });

  if (error) {
    console.error("[memory-store] Search error:", error);
    return [];
  }

  return (data ?? []) as StoredMemory[];
}

/**
 * Save a new memory with conflict resolution.
 * If a very similar memory exists (similarity > 0.85), reinforce it instead of duplicating.
 * If a contradicting memory exists, supersede it.
 */
export async function saveMemory(
  adminSupabase: AdminDb,
  workspaceId: string,
  memory: ExtractedMemory,
  userId?: string,
  conversationId?: string
): Promise<{
  action: "added" | "reinforced" | "superseded" | "skipped";
  memoryId?: string;
}> {
  try {
    // Generate embedding for the new memory
    const embedding = await createEmbedding(memory.content);
    if (!embedding.length) {
      console.warn("[memory-store] Empty embedding for memory, skipping");
      return { action: "skipped" };
    }

    // Check for similar existing memories
    const similar = await findSimilarMemories(
      adminSupabase,
      workspaceId,
      embedding,
      3
    );

    // High similarity = likely duplicate or update
    const highMatch = similar.find((s) => (s.similarity ?? 0) > 0.85);

    if (highMatch) {
      // Very similar memory exists
      if (memory.type === "correction" && highMatch.type === "correction") {
        // Correction supersedes old correction
        const { data } = await adminSupabase
          .from("workspace_memories")
          .insert({
            workspace_id: workspaceId,
            user_id: memory.scope === "user" ? userId : null,
            agent_id: memory.scope === "agent" ? "cleverbrain" : null,
            scope: memory.scope,
            type: memory.type,
            content: memory.content,
            embedding: `[${embedding.join(",")}]`,
            confidence: memory.confidence,
            source_conversation_id: conversationId,
          })
          .select("id")
          .single();

        if (data) {
          // Mark old memory as superseded
          await adminSupabase
            .from("workspace_memories")
            .update({ superseded_by: data.id })
            .eq("id", highMatch.id);

          return { action: "superseded", memoryId: data.id };
        }
      }

      // Same or very similar content — just reinforce
      await adminSupabase
        .from("workspace_memories")
        .update({
          times_reinforced: highMatch.times_reinforced + 1,
          last_used_at: new Date().toISOString(),
          confidence:
            memory.confidence === "high" ? "high" : highMatch.confidence,
        })
        .eq("id", highMatch.id);

      return { action: "reinforced", memoryId: highMatch.id };
    }

    // No similar memory — add new one
    const { data, error } = await adminSupabase
      .from("workspace_memories")
      .insert({
        workspace_id: workspaceId,
        user_id: memory.scope === "user" ? userId : null,
        agent_id: memory.scope === "agent" ? "cleverbrain" : null,
        scope: memory.scope,
        type: memory.type,
        content: memory.content,
        embedding: `[${embedding.join(",")}]`,
        confidence: memory.confidence,
        source_conversation_id: conversationId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[memory-store] Insert error:", error);
      return { action: "skipped" };
    }

    return { action: "added", memoryId: data?.id };
  } catch (error) {
    console.error("[memory-store] Save error:", error);
    return { action: "skipped" };
  }
}

/**
 * Fetch all terminology and correction memories for a workspace.
 * These are foundational knowledge that applies to every conversation,
 * so they bypass similarity search entirely.
 */
async function fetchFoundationalMemories(
  adminSupabase: AdminDb,
  workspaceId: string,
  userId?: string
): Promise<StoredMemory[]> {
  const { data, error } = await adminSupabase
    .from("workspace_memories")
    .select(
      "id, scope, type, content, confidence, times_reinforced, last_used_at, created_at"
    )
    .eq("workspace_id", workspaceId)
    .is("superseded_by", null)
    .in("type", ["terminology", "correction", "resource"])
    .or(
      `scope.eq.workspace,scope.eq.agent${userId ? `,and(scope.eq.user,user_id.eq.${userId})` : ""}`
    )
    .order("times_reinforced", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[memory-store] Foundational fetch error:", error);
    return [];
  }

  return (data ?? []) as StoredMemory[];
}

/**
 * Retrieve relevant memories for a given query.
 * Called before each conversation to inject context into the system prompt.
 *
 * Terminology and correction memories are ALWAYS included (foundational knowledge).
 * Pattern, preference, and learning memories are ranked by similarity to the query.
 */
export async function retrieveMemories(
  adminSupabase: AdminDb,
  workspaceId: string,
  query: string,
  userId?: string,
  limit: number = 15
): Promise<StoredMemory[]> {
  try {
    // Run both fetches in parallel
    const [foundational, embedding] = await Promise.all([
      fetchFoundationalMemories(adminSupabase, workspaceId, userId),
      createEmbedding(query),
    ]);

    // Similarity search for non-foundational types
    let similarityMemories: StoredMemory[] = [];
    if (embedding.length > 0) {
      const { data, error } = await adminSupabase.rpc(
        "search_workspace_memories",
        {
          p_workspace_id: workspaceId,
          p_query_embedding: `[${embedding.join(",")}]`,
          p_user_id: userId ?? null,
          p_limit: limit,
        }
      );

      if (error) {
        console.error("[memory-store] Similarity search error:", error);
      } else {
        similarityMemories = (data ?? []) as StoredMemory[];
      }
    }

    // Merge: foundational first, then similarity results (deduplicated)
    const foundationalIds = new Set(foundational.map((m) => m.id));
    const dedupedSimilarity = similarityMemories.filter(
      (m) => !foundationalIds.has(m.id)
    );
    const memories = [...foundational, ...dedupedSimilarity];

    // Update last_used_at for retrieved memories (fire and forget)
    const memoryIds = memories.map((m) => m.id);
    if (memoryIds.length > 0) {
      void Promise.resolve(
        adminSupabase
          .from("workspace_memories")
          .update({ last_used_at: new Date().toISOString() })
          .in("id", memoryIds)
      ).catch(() => {});
    }

    if (foundational.length > 0) {
      console.log(
        `[memory-store] ${foundational.length} foundational + ${dedupedSimilarity.length} similarity memories retrieved`
      );
    }

    return memories;
  } catch (error) {
    console.error("[memory-store] Retrieve error:", error);
    return [];
  }
}

/**
 * Get all active memories for a workspace (for the extraction dedup check).
 */
export async function getAllMemoryContents(
  adminSupabase: AdminDb,
  workspaceId: string
): Promise<string[]> {
  const { data } = await adminSupabase
    .from("workspace_memories")
    .select("content")
    .eq("workspace_id", workspaceId)
    .is("superseded_by", null)
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []).map((m) => m.content);
}

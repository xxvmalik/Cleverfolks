import { createEmbedding } from "@/lib/embeddings";
import type { createAdminSupabaseClient } from "@/lib/supabase-admin";

type AdminDb = ReturnType<typeof createAdminSupabaseClient>;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Embed a completed conversation into document_chunks for RAG search.
 * Groups messages into chunks of ~3-4 exchanges to maintain context.
 */
export async function embedChatHistory(
  adminSupabase: AdminDb,
  workspaceId: string,
  conversationId: string,
  messages: ChatMessage[],
  userId?: string
): Promise<void> {
  if (messages.length < 2) return;

  // Check if this conversation was already embedded (avoid duplicates on re-runs)
  const { data: existingDoc } = await adminSupabase
    .from("synced_documents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("external_id", `cleverbrain_chat_${conversationId}`)
    .limit(1);

  if (existingDoc && existingDoc.length > 0) {
    console.log(`[chat-embedder] Conversation ${conversationId} already embedded -- skipping`);
    return;
  }

  // Group messages into chunks of ~3-4 exchanges (6-8 messages)
  const MESSAGES_PER_CHUNK = 8;
  const chunks: string[] = [];

  for (let i = 0; i < messages.length; i += MESSAGES_PER_CHUNK) {
    const slice = messages.slice(i, i + MESSAGES_PER_CHUNK);
    const chunkText = slice
      .map((m) => `${m.role === "user" ? "User" : "CleverBrain"}: ${m.content}`)
      .join("\n\n");

    const date = new Date().toISOString().split("T")[0];
    const prefixed = `[CleverBrain conversation | Date: ${date}]\n\n${chunkText}`;
    chunks.push(prefixed);
  }

  // Build full content for the parent document
  const fullContent = messages
    .map((m) => `${m.role === "user" ? "User" : "CleverBrain"}: ${m.content}`)
    .join("\n\n");

  // Create parent document via upsert_synced_document
  // We need an integration_id — use a sentinel value for internal sources.
  // First, upsert a virtual "cleverbrain" integration for this workspace.
  let integrationId: string | null = null;

  const { data: existingIntegration } = await adminSupabase
    .from("integrations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "cleverbrain")
    .maybeSingle();

  if (existingIntegration) {
    integrationId = existingIntegration.id;
  } else {
    const { data: newIntegration } = await adminSupabase
      .from("integrations")
      .insert({
        workspace_id: workspaceId,
        provider: "cleverbrain",
        status: "connected",
        nango_connection_id: `internal_cleverbrain_${workspaceId}`,
      })
      .select("id")
      .single();
    integrationId = newIntegration?.id ?? null;
  }

  if (!integrationId) {
    console.error("[chat-embedder] Failed to get/create cleverbrain integration");
    return;
  }

  const title = `CleverBrain conversation ${new Date().toISOString().split("T")[0]}`;

  const { data: documentId, error: docError } = await adminSupabase.rpc(
    "upsert_synced_document",
    {
      p_workspace_id: workspaceId,
      p_integration_id: integrationId,
      p_source_type: "cleverbrain_chat",
      p_external_id: `cleverbrain_chat_${conversationId}`,
      p_title: title,
      p_content: fullContent,
      p_metadata: {
        conversation_id: conversationId,
        user_id: userId,
        date: new Date().toISOString(),
        message_count: messages.length,
      },
    }
  );

  if (docError || !documentId) {
    console.error("[chat-embedder] Failed to upsert document:", docError?.message);
    return;
  }

  // Delete old chunks if re-embedding
  await adminSupabase.rpc("delete_chunks_for_document", {
    p_document_id: documentId,
  });

  // Embed each chunk
  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await createEmbedding(chunks[i]);
      if (!embedding || embedding.length === 0) {
        console.warn(`[chat-embedder] Chunk ${i} skipped -- no embedding`);
        continue;
      }

      const { error: chunkError } = await adminSupabase.rpc("create_document_chunk", {
        p_document_id: documentId,
        p_workspace_id: workspaceId,
        p_chunk_text: chunks[i],
        p_chunk_index: i,
        p_embedding: `[${embedding.join(",")}]`,
        p_metadata: {
          source_type: "cleverbrain_chat",
          conversation_id: conversationId,
          user_id: userId,
          date: new Date().toISOString(),
          chunk_of: chunks.length,
        },
      });

      if (chunkError) {
        console.error(`[chat-embedder] Failed to embed chunk ${i}:`, chunkError.message);
      } else {
        embedded++;
      }
    } catch (error) {
      console.error(`[chat-embedder] Failed to embed chunk ${i}:`, error);
    }
  }

  console.log(`[chat-embedder] Embedded ${embedded}/${chunks.length} chunks from conversation ${conversationId}`);
}

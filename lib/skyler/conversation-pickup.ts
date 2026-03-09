/**
 * Conversation Pickup for Skyler Sales Closer.
 * When a user enables Skyler on existing leads, this reads previous email threads
 * to understand context before continuing the conversation.
 */

import { classifyWithGPT4oMini } from "@/lib/openai-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

export type ConversationContext = {
  summary: string;
  last_message_from: "user" | "contact" | "unknown";
  awaiting_response: boolean;
  tone_of_conversation: string;
  key_topics: string[];
  open_questions: string[];
  suggested_next_action: string;
  email_count: number;
};

const PICKUP_PROMPT = `You are analysing an email thread between a salesperson and a prospect to understand the conversation state.

Produce a structured JSON response:
- summary: 2-3 sentence overview of what has been discussed
- last_message_from: "user" (the salesperson/company) or "contact" (the prospect) or "unknown"
- awaiting_response: boolean -- is the prospect waiting for a reply from us?
- tone_of_conversation: one of "positive", "neutral", "cold", "frustrated", "warm"
- key_topics: array of 3-5 key topics discussed
- open_questions: array of unanswered questions from either side
- suggested_next_action: one sentence describing what should happen next

Respond with ONLY valid JSON. Do NOT wrap in markdown code fences. Do NOT include \`\`\`json or \`\`\` markers.`;

/**
 * Read existing email threads with a contact and produce a conversation context summary.
 * Optionally creates a pipeline record.
 */
export async function pickupExistingConversation(params: {
  workspaceId: string;
  contactEmail: string;
  contactName?: string;
  contactId?: string;
  companyName?: string;
  db: SupabaseClient;
  createPipelineRecord?: boolean;
}): Promise<ConversationContext> {
  const { workspaceId, contactEmail, contactName, db, createPipelineRecord } = params;

  // Search document_chunks for all emails to/from this contact
  const { data: emailChunks } = await db
    .from("document_chunks")
    .select("chunk_text, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .in("metadata->>source_type", ["gmail_message", "outlook_email"])
    .or(`chunk_text.ilike.%${contactEmail}%,chunk_text.ilike.%${contactName ?? "NOMATCH"}%`)
    .order("created_at", { ascending: true })
    .limit(50);

  if (!emailChunks || emailChunks.length === 0) {
    return {
      summary: `No previous email history found for ${contactName ?? contactEmail}.`,
      last_message_from: "unknown",
      awaiting_response: false,
      tone_of_conversation: "neutral",
      key_topics: [],
      open_questions: [],
      suggested_next_action: "Start fresh outreach to this contact.",
      email_count: 0,
    };
  }

  // Build chronological thread
  const threadText = emailChunks
    .map((c, i) => `--- Email ${i + 1} ---\n${(c.chunk_text as string).slice(0, 400)}`)
    .join("\n\n")
    .slice(0, 6000);

  try {
    const text = await classifyWithGPT4oMini({
      systemPrompt: PICKUP_PROMPT,
      userContent: `Email thread (chronological order):\n${threadText}`,
      maxTokens: 500,
    });

    const context = parseAIJson<ConversationContext>(text);
    context.email_count = emailChunks.length;

    // Determine initial stage based on conversation state
    let stage = "initial_outreach";
    if (context.awaiting_response) {
      stage = "negotiation"; // We need to respond
    } else if (emailChunks.length >= 3) {
      stage = "follow_up_2";
    } else if (emailChunks.length >= 1) {
      stage = "follow_up_1";
    }

    // Optionally create a pipeline record with context
    if (createPipelineRecord) {
      const { data: existing } = await db
        .from("skyler_sales_pipeline")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("contact_email", contactEmail)
        .single();

      if (!existing) {
        await db.from("skyler_sales_pipeline").insert({
          workspace_id: workspaceId,
          contact_id: params.contactId ?? contactEmail,
          contact_name: contactName ?? contactEmail,
          contact_email: contactEmail,
          company_name: params.companyName ?? null,
          stage,
          cadence_step: emailChunks.length,
          emails_sent: emailChunks.length,
          awaiting_reply: context.awaiting_response,
          conversation_thread: emailChunks.map((c) => ({
            role: "historical",
            content: (c.chunk_text as string).slice(0, 300),
            timestamp: c.created_at,
          })),
        });
        console.log(`[conversation-pickup] Created pipeline record for ${contactEmail} at stage ${stage}`);
      }
    }

    console.log(`[conversation-pickup] Analysed ${emailChunks.length} emails for ${contactEmail} (GPT-4o-mini): ${context.summary.slice(0, 100)}`);
    return context;
  } catch (err) {
    console.error("[conversation-pickup] Analysis failed (GPT-4o-mini):", err instanceof Error ? err.message : String(err));
    return {
      summary: `Found ${emailChunks.length} emails with ${contactName ?? contactEmail} but analysis failed.`,
      last_message_from: "unknown",
      awaiting_response: false,
      tone_of_conversation: "neutral",
      key_topics: [],
      open_questions: [],
      suggested_next_action: "Review the email history manually and decide on next steps.",
      email_count: emailChunks.length,
    };
  }
}

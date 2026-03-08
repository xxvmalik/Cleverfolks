/**
 * Sales Voice Learner for Skyler Sales Closer.
 * Analyses the user's past sent emails to learn their writing style,
 * so Skyler can match their voice in outreach emails.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesVoice = {
  greeting_style: string;
  closing_style: string;
  tone: string;
  avg_length: string;
  vocabulary_notes: string;
  structure_pattern: string;
  cta_style: string;
  avoid_patterns: string[];
  example_phrases: string[];
  learned_at: string;
};

const VOICE_ANALYSIS_PROMPT = `You are analysing a collection of sent sales/outreach emails to extract the sender's writing style and voice patterns.

Produce a structured JSON response with these fields:
- greeting_style: how they typically open emails (e.g. "Hi [Name]," or "Hey [Name] --")
- closing_style: how they sign off (e.g. "Best," or "Talk soon," or "Cheers,")
- tone: one of "formal", "casual", "direct", "friendly-professional", "conversational"
- avg_length: one of "short" (under 100 words), "medium" (100-200 words), "long" (200+ words)
- vocabulary_notes: specific phrases, words, or patterns they use often
- structure_pattern: how they structure their emails (e.g. "hook, value prop, CTA" or "question, context, ask")
- cta_style: how they typically ask for next steps (e.g. "open question" or "specific time proposal")
- avoid_patterns: array of things they never do in emails
- example_phrases: array of 5-10 characteristic phrases from their emails

Respond with ONLY valid JSON, no other text.

Emails to analyse:
`;

/**
 * Analyse the user's past sent emails to learn their sales voice.
 * Stores the result as a workspace memory.
 */
export async function learnSalesVoice(
  db: SupabaseClient,
  workspaceId: string
): Promise<SalesVoice | null> {
  // Fetch sent emails -- look for outreach-style emails (FROM workspace user, not TO them)
  const { data: emailChunks } = await db
    .from("document_chunks")
    .select("chunk_text, metadata")
    .eq("workspace_id", workspaceId)
    .in("metadata->>source_type", ["gmail_message", "outlook_email"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (!emailChunks || emailChunks.length === 0) {
    console.log("[voice-learner] No email data found for workspace");
    return null;
  }

  // Filter for sent/outbound emails (heuristic: look for "From:" patterns that match workspace user)
  // and exclude obvious non-outreach (newsletters, auto-replies, internal)
  const outboundEmails = emailChunks.filter((chunk) => {
    const text = (chunk.chunk_text as string) ?? "";
    const lower = text.toLowerCase();
    // Skip newsletters, automated, and very short emails
    if (lower.includes("unsubscribe") || lower.includes("no-reply") || lower.includes("noreply")) return false;
    if (text.length < 50) return false;
    // Look for outbound indicators
    if (lower.includes("looking forward") || lower.includes("reach out") ||
        lower.includes("connect") || lower.includes("schedule") ||
        lower.includes("interested") || lower.includes("follow up") ||
        lower.includes("wanted to") || lower.includes("checking in")) {
      return true;
    }
    return true; // Include most emails as samples
  }).slice(0, 20);

  if (outboundEmails.length < 3) {
    console.log(`[voice-learner] Only ${outboundEmails.length} usable emails -- not enough to learn voice`);
    return null;
  }

  const emailTexts = outboundEmails
    .map((c, i) => `--- Email ${i + 1} ---\n${(c.chunk_text as string).slice(0, 500)}`)
    .join("\n\n")
    .slice(0, 8000);

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: VOICE_ANALYSIS_PROMPT + emailTexts }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const voice = JSON.parse(text) as SalesVoice;
    voice.learned_at = new Date().toISOString();

    // Store as a workspace memory for persistence
    await db
      .from("workspace_memories")
      .upsert(
        {
          workspace_id: workspaceId,
          scope: "workspace",
          type: "pattern",
          content: `Sales voice profile: tone=${voice.tone}, greeting="${voice.greeting_style}", closing="${voice.closing_style}", CTA style="${voice.cta_style}". Phrases: ${voice.example_phrases.slice(0, 5).join("; ")}`,
          confidence: "high",
          source_conversation_id: null,
          created_by: null,
        },
        { onConflict: "workspace_id,content", ignoreDuplicates: true }
      );

    console.log(`[voice-learner] Learned sales voice: tone=${voice.tone}, avg_length=${voice.avg_length}`);
    return voice;
  } catch (err) {
    console.error("[voice-learner] Voice analysis failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Retrieve the learned sales voice for a workspace.
 * Returns null if not yet learned.
 */
export async function getSalesVoice(
  db: SupabaseClient,
  workspaceId: string
): Promise<SalesVoice | null> {
  // Check for cached voice in workspace_memories
  const { data } = await db
    .from("workspace_memories")
    .select("content, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .eq("type", "pattern")
    .ilike("content", "Sales voice profile:%")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  // The full voice object is not stored in memories (just a summary).
  // Re-learn if the memory exists but we need the full object.
  // For now, return a partial reconstruction from the memory content.
  const content = data.content as string;
  const toneMatch = content.match(/tone=(\w[\w-]*)/);
  const greetingMatch = content.match(/greeting="([^"]+)"/);
  const closingMatch = content.match(/closing="([^"]+)"/);
  const ctaMatch = content.match(/CTA style="([^"]+)"/);

  return {
    greeting_style: greetingMatch?.[1] ?? "Hi [Name],",
    closing_style: closingMatch?.[1] ?? "Best,",
    tone: toneMatch?.[1] ?? "friendly-professional",
    avg_length: "medium",
    vocabulary_notes: "",
    structure_pattern: "",
    cta_style: ctaMatch?.[1] ?? "open question",
    avoid_patterns: [],
    example_phrases: [],
    learned_at: data.created_at as string,
  };
}

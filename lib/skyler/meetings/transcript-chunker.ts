/**
 * Transcript Chunker for Meeting Intelligence.
 *
 * Takes raw transcript segments (speaker-attributed), groups them into
 * 500-800 token chunks at speaker-turn boundaries, embeds each chunk
 * with Voyage AI, and stores in meeting_chunks for semantic search.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createEmbeddings } from "@/lib/embeddings";
import type { TranscriptSegment } from "@/lib/recall/client";

// Rough token estimate: ~4 chars per token
const TARGET_CHUNK_TOKENS = 600;
const MAX_CHUNK_TOKENS = 800;
const CHARS_PER_TOKEN = 4;

type Chunk = {
  text: string;
  speakerName: string;
  startTime: number | null;
  endTime: number | null;
};

/**
 * Chunk a transcript at speaker-turn boundaries and embed for semantic search.
 */
export async function chunkAndEmbedTranscript(params: {
  transcriptId: string;
  leadId: string;
  workspaceId: string;
  segments: TranscriptSegment[];
}): Promise<number> {
  const { transcriptId, leadId, workspaceId, segments } = params;

  if (!segments || segments.length === 0) return 0;

  // Step 1: Build chunks from segments
  const chunks = buildChunks(segments);
  if (chunks.length === 0) return 0;

  // Step 2: Embed all chunks
  const chunkTexts = chunks.map((c) => c.text);
  const embeddings = await createEmbeddings(chunkTexts);

  // Step 3: Store in database
  const db = createAdminSupabaseClient();
  const rows = chunks.map((chunk, i) => ({
    transcript_id: transcriptId,
    lead_id: leadId,
    workspace_id: workspaceId,
    speaker_name: chunk.speakerName,
    chunk_text: chunk.text,
    embedding: JSON.stringify(embeddings[i]),
    start_time: chunk.startTime,
    end_time: chunk.endTime,
  }));

  // Insert in batches of 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await db.from("meeting_chunks").insert(batch);
    if (error) {
      console.error(`[transcript-chunker] Insert error:`, error.message);
    }
  }

  console.log(
    `[transcript-chunker] Created ${chunks.length} chunks for transcript ${transcriptId}`
  );
  return chunks.length;
}

/**
 * Build chunks from transcript segments, grouping at speaker-turn boundaries.
 * Each chunk targets 500-800 tokens. If a single segment exceeds max, it gets
 * its own chunk (we don't split mid-sentence).
 */
function buildChunks(segments: TranscriptSegment[]): Chunk[] {
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentSpeaker = "";
  let currentCharCount = 0;
  let chunkStartTime: number | null = null;
  let chunkEndTime: number | null = null;

  for (const segment of segments) {
    const speaker = segment.speaker ?? "Unknown";
    const text = (segment.words ?? []).map((w) => w.text).join(" ").trim();
    if (!text) continue;

    const line = `${speaker}: ${text}`;
    const lineChars = line.length;

    // Get timing from first/last word
    const firstWord = segment.words?.[0];
    const lastWord = segment.words?.[segment.words.length - 1];
    const segStart = firstWord?.start_time ?? null;
    const segEnd = lastWord?.end_time ?? null;

    // Check if adding this segment would exceed the max
    const wouldExceedMax =
      currentCharCount + lineChars > MAX_CHUNK_TOKENS * CHARS_PER_TOKEN &&
      currentLines.length > 0;

    // Check if we hit target and speaker changed (natural break)
    const atTargetWithSpeakerChange =
      currentCharCount >= TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN &&
      speaker !== currentSpeaker &&
      currentLines.length > 0;

    if (wouldExceedMax || atTargetWithSpeakerChange) {
      // Flush current chunk
      chunks.push({
        text: currentLines.join("\n"),
        speakerName: currentSpeaker,
        startTime: chunkStartTime,
        endTime: chunkEndTime,
      });
      currentLines = [];
      currentCharCount = 0;
      chunkStartTime = null;
    }

    currentLines.push(line);
    currentCharCount += lineChars;
    currentSpeaker = speaker;
    if (chunkStartTime === null && segStart !== null) chunkStartTime = segStart;
    if (segEnd !== null) chunkEndTime = segEnd;
  }

  // Flush remaining
  if (currentLines.length > 0) {
    chunks.push({
      text: currentLines.join("\n"),
      speakerName: currentSpeaker,
      startTime: chunkStartTime,
      endTime: chunkEndTime,
    });
  }

  return chunks;
}

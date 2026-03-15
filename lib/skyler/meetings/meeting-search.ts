/**
 * Semantic search over meeting transcript chunks.
 *
 * Uses pgvector cosine similarity via the search_meeting_chunks RPC function
 * to find relevant sections of meeting transcripts for a given query.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createEmbedding } from "@/lib/embeddings";

export type MeetingSearchResult = {
  id: string;
  transcript_id: string;
  speaker_name: string;
  chunk_text: string;
  start_time: number | null;
  end_time: number | null;
  similarity: number;
};

/**
 * Search meeting transcripts for a lead using semantic similarity.
 * Returns the most relevant chunks ordered by similarity.
 */
export async function searchMeetingTranscripts(params: {
  workspaceId: string;
  leadId: string;
  query: string;
  matchCount?: number;
  minSimilarity?: number;
}): Promise<MeetingSearchResult[]> {
  const { workspaceId, leadId, query, matchCount = 5, minSimilarity = 0.5 } = params;

  // Generate query embedding
  const queryEmbedding = await createEmbedding(query);
  if (!queryEmbedding || queryEmbedding.length === 0) {
    console.warn("[meeting-search] Failed to generate query embedding");
    return [];
  }

  const db = createAdminSupabaseClient();

  const { data, error } = await db.rpc("search_meeting_chunks", {
    p_workspace_id: workspaceId,
    p_lead_id: leadId,
    p_query_embedding: JSON.stringify(queryEmbedding),
    p_match_count: matchCount,
    p_min_similarity: minSimilarity,
  });

  if (error) {
    console.error("[meeting-search] Search error:", error.message);
    return [];
  }

  return (data ?? []) as MeetingSearchResult[];
}

/**
 * Get the full transcript text for a specific meeting.
 * Used when the reasoning layer needs more detail than the summary provides.
 */
export async function getFullMeetingTranscript(
  transcriptId: string
): Promise<string | null> {
  const db = createAdminSupabaseClient();

  const { data } = await db
    .from("meeting_transcripts")
    .select("raw_transcript")
    .eq("id", transcriptId)
    .maybeSingle();

  if (!data?.raw_transcript) return null;

  const segments = data.raw_transcript as Array<{
    speaker?: string;
    words?: Array<{ text: string }>;
  }>;

  return segments
    .map((s) => {
      const speaker = s.speaker ?? "Unknown";
      const text = (s.words ?? []).map((w) => w.text).join(" ");
      return `${speaker}: ${text}`;
    })
    .join("\n");
}

/**
 * Load meeting intelligence summary for a lead.
 * Returns the most recent meeting's summary and intelligence data.
 */
export async function getLeadMeetingContext(
  leadId: string
): Promise<{
  hasMeetings: boolean;
  meetingCount: number;
  latestMeeting: {
    id: string;
    meetingDate: string;
    summary: string | null;
    intelligence: Record<string, unknown> | null;
    participants: Array<{ name: string }> | null;
  } | null;
} | null> {
  const db = createAdminSupabaseClient();

  const { data: meetings } = await db
    .from("meeting_transcripts")
    .select("id, meeting_date, summary, intelligence, participants, processing_status")
    .eq("lead_id", leadId)
    .eq("processing_status", "complete")
    .order("meeting_date", { ascending: false })
    .limit(5);

  if (!meetings || meetings.length === 0) {
    return { hasMeetings: false, meetingCount: 0, latestMeeting: null };
  }

  const latest = meetings[0];
  return {
    hasMeetings: true,
    meetingCount: meetings.length,
    latestMeeting: {
      id: latest.id as string,
      meetingDate: latest.meeting_date as string,
      summary: latest.summary as string | null,
      intelligence: latest.intelligence as Record<string, unknown> | null,
      participants: latest.participants as Array<{ name: string }> | null,
    },
  };
}

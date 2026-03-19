/**
 * GET /api/skyler/meetings/{transcriptId}
 *
 * Returns the full raw transcript for the expandable transcript view.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ transcriptId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { transcriptId } = await params;

  const db = createAdminSupabaseClient();

  // Handle pipeline-prefixed IDs (fallback meetings stored on pipeline record)
  if (transcriptId.startsWith("pipeline-")) {
    const pipelineId = transcriptId.replace("pipeline-", "");

    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("meeting_transcript")
      .eq("id", pipelineId)
      .maybeSingle();

    if (!pipeline?.meeting_transcript) {
      return NextResponse.json({ transcript: [] });
    }

    // Parse the real-time transcript text (format: "Speaker: text\nSpeaker: text\n...")
    const rawText = pipeline.meeting_transcript as string;
    const lines = rawText.split("\n").filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(": ");
      if (colonIdx > 0) {
        return {
          speaker: line.slice(0, colonIdx),
          text: line.slice(colonIdx + 2),
          timestamp: null,
        };
      }
      return { speaker: "Unknown", text: line, timestamp: null };
    });

    return NextResponse.json({ transcript: lines });
  }

  const { data, error } = await db
    .from("meeting_transcripts")
    .select("raw_transcript, lead_id")
    .eq("id", transcriptId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If raw_transcript is null, fall back to pipeline record's real-time transcript
  if (!data.raw_transcript) {
    const leadId = (data as { lead_id?: string }).lead_id;
    if (leadId) {
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("meeting_transcript")
        .eq("id", leadId)
        .maybeSingle();

      if (pipeline?.meeting_transcript) {
        const rawText = pipeline.meeting_transcript as string;
        const fallbackLines = rawText.split("\n").filter(Boolean).map((line) => {
          const colonIdx = line.indexOf(": ");
          if (colonIdx > 0) {
            return {
              speaker: line.slice(0, colonIdx),
              text: line.slice(colonIdx + 2),
              timestamp: null,
            };
          }
          return { speaker: "Unknown", text: line, timestamp: null };
        });
        return NextResponse.json({ transcript: fallbackLines });
      }
    }
    return NextResponse.json({ transcript: [] });
  }

  // Format raw transcript into readable lines
  const raw = data.raw_transcript as Array<{
    speaker?: string;
    words?: Array<{ text: string; start_time?: number }>;
  }> | null;

  if (!raw || !Array.isArray(raw)) {
    return NextResponse.json({ transcript: [] });
  }

  const lines = raw.map((segment) => ({
    speaker: segment.speaker ?? "Unknown",
    text: (segment.words ?? []).map((w) => w.text).join(" "),
    timestamp: segment.words?.[0]?.start_time ?? null,
  }));

  return NextResponse.json({ transcript: lines });
}

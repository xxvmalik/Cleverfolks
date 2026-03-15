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

  const { data, error } = await db
    .from("meeting_transcripts")
    .select("raw_transcript")
    .eq("id", transcriptId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

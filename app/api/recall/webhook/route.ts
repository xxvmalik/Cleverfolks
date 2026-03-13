/**
 * POST /api/recall/webhook
 *
 * Receives Recall.ai bot status and transcript events.
 * When a bot finishes recording (bot.done), fires an Inngest event
 * to process the transcript and classify the meeting outcome.
 */

import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const event = payload.event as string;
    const botId = payload.data?.bot?.id as string;

    if (!event || !botId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    console.log(`[recall-webhook] Event: ${event} for bot ${botId}`);

    // Handle real-time transcript chunks — accumulate in DB
    if (event === "transcript.data") {
      const words = payload.data?.data?.words as Array<{ text: string }> | undefined;
      const participant = payload.data?.data?.participant as { name?: string } | undefined;
      if (words && words.length > 0) {
        const speaker = participant?.name ?? "Unknown";
        const text = words.map((w) => w.text).join(" ");
        const line = `${speaker}: ${text}`;

        // Append transcript line to pipeline record
        const db = createAdminSupabaseClient();
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("id, meeting_transcript")
          .eq("recall_bot_id", botId)
          .maybeSingle();

        if (pipeline) {
          const existing = (pipeline.meeting_transcript as string) ?? "";
          await db
            .from("skyler_sales_pipeline")
            .update({
              meeting_transcript: existing ? `${existing}\n${line}` : line,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pipeline.id);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // Bot finished — trigger transcript processing
    if (event === "bot.done") {
      // Find the pipeline record for this bot
      const db = createAdminSupabaseClient();
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name")
        .eq("recall_bot_id", botId)
        .maybeSingle();

      if (!pipeline) {
        console.warn(`[recall-webhook] No pipeline found for bot ${botId}`);
        return NextResponse.json({ ok: true });
      }

      // Fire Inngest event to process the transcript
      await inngest.send({
        name: "skyler/meeting.transcript.ready",
        data: {
          pipelineId: pipeline.id,
          workspaceId: pipeline.workspace_id,
          botId,
          contactEmail: pipeline.contact_email,
          contactName: pipeline.contact_name,
          companyName: pipeline.company_name,
        },
      });

      console.log(`[recall-webhook] Transcript ready event fired for pipeline ${pipeline.id}`);
      return NextResponse.json({ ok: true });
    }

    // Bot errors
    if (event === "bot.fatal") {
      console.error(`[recall-webhook] Bot ${botId} encountered a fatal error`);
      const db = createAdminSupabaseClient();
      await db
        .from("skyler_sales_pipeline")
        .update({
          meeting_outcome: { error: "Recording bot failed", event },
          updated_at: new Date().toISOString(),
        })
        .eq("recall_bot_id", botId);

      return NextResponse.json({ ok: true });
    }

    // Other status events — log and acknowledge
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recall-webhook] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true }); // Always 200 to prevent Recall retries
  }
}

/**
 * POST /api/recall/webhook
 *
 * Receives Recall.ai bot status and transcript events from the
 * account-level webhook configured in the Recall dashboard.
 *
 * Events we subscribe to:
 * - bot.done — meeting ended, triggers transcript processing
 * - bot.fatal — bot crashed
 * - recording.done — recording ready
 * - meeting_metadata.done — metadata processed
 */

import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallTranscript } from "@/lib/recall/client";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Dashboard webhooks use "event" at top level
    // Real-time endpoints use "data.event"
    const event = (payload.event ?? payload.data?.event) as string;

    // Bot ID can be in different locations depending on event format
    const botId = (
      payload.data?.bot_id            // dashboard webhook format
      ?? payload.data?.bot?.id        // real-time endpoint format
      ?? payload.data?.data?.bot_id   // nested format
    ) as string;

    if (!event || !botId) {
      console.warn(`[recall-webhook] Missing event or botId`, { event, botId, keys: Object.keys(payload) });
      return NextResponse.json({ ok: true }); // Don't return 400 — avoid retries
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
    if (event === "bot.done" || event === "bot.status_change.done" || event === "recording.done" || event === "meeting_metadata.done") {
      const db = createAdminSupabaseClient();
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_email, contact_name, company_name, meeting_outcome")
        .eq("recall_bot_id", botId)
        .maybeSingle();

      if (!pipeline) {
        console.warn(`[recall-webhook] No pipeline found for bot ${botId}`);
        return NextResponse.json({ ok: true });
      }

      // Skip if already processed (avoid duplicate processing from multiple events)
      if (pipeline.meeting_outcome) {
        console.log(`[recall-webhook] Pipeline ${pipeline.id} already has meeting outcome, skipping`);
        return NextResponse.json({ ok: true });
      }

      // Pull full transcript from Recall API (more reliable than real-time chunks)
      try {
        const transcript = await getRecallTranscript(botId);
        if (transcript && transcript.trim().length > 0) {
          const { data: current } = await db
            .from("skyler_sales_pipeline")
            .select("meeting_transcript")
            .eq("id", pipeline.id)
            .single();

          const existing = (current?.meeting_transcript as string) ?? "";
          if (transcript.length > existing.length) {
            await db
              .from("skyler_sales_pipeline")
              .update({ meeting_transcript: transcript, updated_at: new Date().toISOString() })
              .eq("id", pipeline.id);
            console.log(`[recall-webhook] Updated transcript from API (${transcript.length} chars)`);
          }
        }
      } catch (err) {
        console.warn(`[recall-webhook] Transcript pull failed:`, err instanceof Error ? err.message : err);
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
    if (event === "bot.fatal" || event === "bot.status_change.fatal") {
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

    // Other events — log and acknowledge
    console.log(`[recall-webhook] Unhandled event: ${event}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recall-webhook] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true }); // Always 200 to prevent Recall retries
  }
}

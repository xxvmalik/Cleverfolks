/**
 * POST /api/recall/webhook
 *
 * Receives Recall.ai bot status and transcript events.
 * Verifies webhook secret, updates recall_bots table,
 * and triggers transcript processing via Inngest.
 *
 * Events handled:
 * - bot.status_change: Track bot lifecycle (joining, in_call, done, fatal)
 * - recording.done / bot.done: Trigger transcript fetch + processing
 * - transcript.data: Real-time transcript chunks (stored on pipeline)
 * - calendar.sync_events: Calendar event changes (delegated to calendar sync)
 */

import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallTranscript, getRecallTranscriptRaw, verifyWebhookSecret } from "@/lib/recall/client";
import { handleCalendarSyncEvent, handleCalendarUpdate } from "@/lib/skyler/meetings/calendar-sync";

export async function POST(req: NextRequest) {
  // Verify webhook secret
  const token = req.nextUrl.searchParams.get("token");
  if (!verifyWebhookSecret(token)) {
    console.warn("[recall-webhook] Invalid webhook secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();

    // Dashboard webhooks use "event" at top level
    // Real-time endpoints use "data.event"
    const event = (payload.event ?? payload.data?.event) as string;

    // Bot ID can be in different locations depending on event format
    const botId = (
      payload.data?.bot_id ??
      payload.data?.bot?.id ??
      payload.data?.data?.bot_id
    ) as string;

    if (!event || !botId) {
      console.warn(`[recall-webhook] Missing event or botId`, {
        event,
        botId,
        keys: Object.keys(payload),
      });
      return NextResponse.json({ ok: true });
    }

    console.log(`[recall-webhook] Event: ${event} for bot ${botId}`);
    const db = createAdminSupabaseClient();

    // ── Update recall_bots table status ─────────────────────────────────
    if (event.startsWith("bot.status_change") || event === "bot.done" || event === "bot.fatal") {
      const statusMap: Record<string, string> = {
        "bot.status_change.joining_call": "joining",
        "bot.status_change.in_waiting_room": "joining",
        "bot.status_change.in_call_not_recording": "in_call",
        "bot.status_change.in_call_recording": "in_call",
        "bot.status_change.done": "done",
        "bot.status_change.fatal": "failed",
        "bot.done": "done",
        "bot.fatal": "failed",
      };

      const newStatus = statusMap[event];
      if (newStatus) {
        await db
          .from("recall_bots")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("recall_bot_id", botId);
      }
    }

    // ── Real-time transcript chunks ─────────────────────────────────────
    if (event === "transcript.data") {
      const words = payload.data?.data?.words as
        | Array<{ text: string }>
        | undefined;
      const participant = payload.data?.data?.participant as
        | { name?: string }
        | undefined;
      if (words && words.length > 0) {
        const speaker = participant?.name ?? "Unknown";
        const text = words.map((w) => w.text).join(" ");
        const line = `${speaker}: ${text}`;

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
              meeting_transcript: existing
                ? `${existing}\n${line}`
                : line,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pipeline.id);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ── Bot finished — trigger transcript processing ────────────────────
    if (
      event === "bot.done" ||
      event === "bot.status_change.done" ||
      event === "recording.done" ||
      event === "meeting_metadata.done"
    ) {
      // Look up the bot record to get workspace + lead context
      const { data: botRecord } = await db
        .from("recall_bots")
        .select("id, workspace_id, lead_id, meeting_url")
        .eq("recall_bot_id", botId)
        .maybeSingle();

      // Also check pipeline record (backward compat with existing recall_bot_id field)
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select(
          "id, workspace_id, contact_email, contact_name, company_name, meeting_outcome"
        )
        .eq("recall_bot_id", botId)
        .maybeSingle();

      if (!pipeline && !botRecord) {
        console.warn(`[recall-webhook] No pipeline or bot record for bot ${botId}`);
        return NextResponse.json({ ok: true });
      }

      // Skip if pipeline already processed
      if (pipeline?.meeting_outcome) {
        console.log(
          `[recall-webhook] Pipeline ${pipeline.id} already has meeting outcome, skipping`
        );
        return NextResponse.json({ ok: true });
      }

      // Pull full transcript from Recall API
      const rawSegments = await getRecallTranscriptRaw(botId);
      const transcriptText = rawSegments
        ? rawSegments
            .map((s) => `${s.speaker ?? "Unknown"}: ${(s.words ?? []).map((w) => w.text).join(" ")}`)
            .join("\n")
        : null;

      // Store transcript on pipeline record (backward compat)
      if (pipeline && transcriptText && transcriptText.trim().length > 0) {
        const { data: current } = await db
          .from("skyler_sales_pipeline")
          .select("meeting_transcript")
          .eq("id", pipeline.id)
          .single();

        const existing = (current?.meeting_transcript as string) ?? "";
        if (transcriptText.length > existing.length) {
          await db
            .from("skyler_sales_pipeline")
            .update({
              meeting_transcript: transcriptText,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pipeline.id);
        }
      }

      // Create meeting_transcripts record for the new intelligence pipeline
      const workspaceId = pipeline?.workspace_id ?? botRecord?.workspace_id;
      const leadId = pipeline?.id ?? botRecord?.lead_id;

      if (workspaceId && leadId && rawSegments) {
        await db.from("meeting_transcripts").insert({
          bot_id: botId,
          workspace_id: workspaceId,
          lead_id: leadId,
          raw_transcript: rawSegments,
          meeting_url: botRecord?.meeting_url,
          meeting_date: new Date().toISOString(),
          processing_status: "pending",
        });
      }

      // Fire Inngest event for processing
      if (pipeline) {
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
        console.log(
          `[recall-webhook] Transcript ready event fired for pipeline ${pipeline.id}`
        );
      }

      return NextResponse.json({ ok: true });
    }

    // ── Bot errors ──────────────────────────────────────────────────────
    if (
      event === "bot.fatal" ||
      event === "bot.status_change.fatal"
    ) {
      console.error(`[recall-webhook] Bot ${botId} encountered a fatal error`);

      // Update pipeline record
      await db
        .from("skyler_sales_pipeline")
        .update({
          meeting_outcome: { error: "Recording bot failed", event },
          updated_at: new Date().toISOString(),
        })
        .eq("recall_bot_id", botId);

      // Update recall_bots record
      await db
        .from("recall_bots")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("recall_bot_id", botId);

      return NextResponse.json({ ok: true });
    }

    // ── Calendar sync events ────────────────────────────────────────────
    if (event === "calendar.sync_events") {
      const calendarId = (payload.data?.calendar_id ?? payload.data?.calendar?.id) as string;
      if (calendarId) {
        const result = await handleCalendarSyncEvent(calendarId);
        console.log(`[recall-webhook] Calendar sync: ${result.scheduled} scheduled, ${result.cancelled} cancelled`);
      }
      return NextResponse.json({ ok: true });
    }

    if (event === "calendar.update") {
      const calendarId = (payload.data?.calendar_id ?? payload.data?.calendar?.id) as string;
      const calendarStatus = (payload.data?.status ?? payload.data?.calendar?.status) as string;
      if (calendarId) {
        await handleCalendarUpdate(calendarId, calendarStatus);
      }
      return NextResponse.json({ ok: true });
    }

    // Other events — log and acknowledge
    console.log(`[recall-webhook] Unhandled event: ${event}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[recall-webhook] Error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ ok: true }); // Always 200 to prevent Recall retries
  }
}

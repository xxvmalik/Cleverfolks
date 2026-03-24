/**
 * Calendar meeting detection for Skyler Sales Closer.
 * Matches calendar event attendees against active pipeline contacts.
 *
 * When a meeting is found with a pipeline lead, atomically updates the
 * pipeline record: stage → meeting_booked (no resolution — lead stays active).
 *
 * Dedup: atomic WHERE resolution IS NULL + unique index on meeting_event_id.
 * Never throws — returns { detected: false } on any error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGES } from "@/lib/skyler/pipeline-stages";
import { dispatchNotification } from "@/lib/skyler/notifications";

export type MeetingRecord = {
  eventId: string;
  attendeeEmails: string[];
  title: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  provider: "google-calendar" | "outlook" | "calendly";
};

export type MeetingDetectionResult = {
  detected: boolean;
  pipeline_id?: string;
  contact_email?: string;
  meetingLink?: string;
  startTime?: string;
};

/**
 * Detect if a calendar event includes an active pipeline contact.
 * If matched, mark the pipeline record as meeting_booked.
 *
 * Never throws — returns { detected: false } on any error.
 */
export async function detectPipelineMeeting(
  db: SupabaseClient,
  workspaceId: string,
  meeting: MeetingRecord
): Promise<MeetingDetectionResult> {
  try {
    const normalizedEmails = meeting.attendeeEmails
      .map((e) => e.toLowerCase().trim())
      .filter(Boolean);

    if (normalizedEmails.length === 0) return { detected: false };

    // Check if any attendee has an active (unresolved) pipeline record
    const { data: pipelines } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_email, contact_name, company_name")
      .eq("workspace_id", workspaceId)
      .is("resolution", null)
      .in("contact_email", normalizedEmails);

    if (!pipelines || pipelines.length === 0) return { detected: false };

    // Take the first matching pipeline record
    const pipeline = pipelines[0];
    const now = new Date().toISOString();

    // Atomic update: only succeeds if resolution is still NULL and not already meeting_booked
    // meeting_booked is a STAGE, not a resolution — keeps the lead card active
    const { data: updated, error: updateErr } = await db
      .from("skyler_sales_pipeline")
      .update({
        stage: STAGES.MEETING_BOOKED,
        meeting_event_id: meeting.eventId,
        meeting_details: {
          title: meeting.title,
          start: meeting.startTime,
          end: meeting.endTime,
          link: meeting.meetingLink ?? null,
          provider: meeting.provider,
          detected_at: now,
        },
        awaiting_reply: false,
        next_followup_at: null,
        cadence_paused: true, // Pause follow-ups during meeting stage
        updated_at: now,
      })
      .eq("id", pipeline.id)
      .is("resolution", null)
      .neq("stage", STAGES.MEETING_BOOKED) // Don't re-detect same meeting
      .select("id")
      .maybeSingle();

    if (updateErr) {
      console.error(`[meeting-detector] Update error: ${updateErr.message}`);
      return { detected: false };
    }

    if (!updated) {
      console.log(
        `[meeting-detector] Skipping — pipeline ${pipeline.id} already resolved`
      );
      return { detected: false };
    }

    console.log(
      `[meeting-detector] Meeting booked! Pipeline ${pipeline.id} — "${meeting.title}" with ${pipeline.contact_email}`
    );

    // Link calendar_events row to this pipeline record (by provider_event_id)
    // This enables the lead-meetings endpoint to find upcoming events for a lead
    try {
      // The eventId format is "provider-originalId" (e.g. "gcal-abc123", "outlook-xyz")
      const providerEventId = meeting.eventId.replace(/^(gcal|outlook|calendly)-/, "");
      const { error: linkErr } = await db
        .from("calendar_events")
        .update({ lead_id: pipeline.id })
        .eq("workspace_id", workspaceId)
        .eq("provider_event_id", providerEventId)
        .is("lead_id", null);

      if (linkErr) {
        console.warn(`[meeting-detector] Failed to link calendar_event: ${linkErr.message}`);
      } else {
        console.log(`[meeting-detector] Linked calendar_event (provider_event_id=${providerEventId}) to pipeline ${pipeline.id}`);
      }
    } catch (linkErr) {
      console.warn("[meeting-detector] Calendar event link failed:", linkErr);
    }

    // Dispatch notification (fire-and-forget)
    try {
      await dispatchNotification(db, {
        workspaceId,
        eventType: "meeting_booked",
        pipelineId: pipeline.id,
        title: `Meeting booked with ${pipeline.contact_name ?? pipeline.contact_email}`,
        body: `"${meeting.title}" scheduled for ${new Date(meeting.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
        metadata: {
          contactEmail: pipeline.contact_email,
          companyName: pipeline.company_name,
          meetingTitle: meeting.title,
          startTime: meeting.startTime,
          endTime: meeting.endTime,
          provider: meeting.provider,
          meetingLink: meeting.meetingLink,
        },
      });
    } catch (notifyErr) {
      console.error("[meeting-detector] Notification failed:", notifyErr);
    }

    return {
      detected: true,
      pipeline_id: pipeline.id,
      contact_email: pipeline.contact_email,
      meetingLink: meeting.meetingLink,
      startTime: meeting.startTime,
    };
  } catch (err) {
    console.warn(
      "[meeting-detector] Detection failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { detected: false };
  }
}

/**
 * Test route: Attendee intelligence end-to-end.
 * GET /api/test/attendee-intel
 *
 * 1. Adds sarah@onaksfitness.com to the Ayomide meeting attendees
 * 2. Runs pipeline email match + domain match
 * 3. Enriches the attendee (Apollo fallback to domain inference)
 * 4. Dispatches "new_attendee_detected" notification (Slack + email)
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { enrichAttendee } from "@/lib/skyler/calendar/attendee-intelligence";
import { dispatchNotification } from "@/lib/skyler/notifications";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";
const CAL_EVENT_ID = "a839a5d5-c8c9-4cff-9d5d-0d4b782cdc21";
const NEW_ATTENDEE_EMAIL = "sarah@onaksfitness.com";
const NEW_ATTENDEE_NAME = "Sarah";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();

    // ── Step 1: Load the calendar event ───────────────────────────────
    const { data: calEvent, error: fetchErr } = await db
      .from("calendar_events")
      .select("id, title, attendees, lead_id, workspace_id")
      .eq("id", CAL_EVENT_ID)
      .single();

    if (!calEvent) {
      return NextResponse.json({
        error: `Calendar event ${CAL_EVENT_ID} not found`,
        detail: fetchErr?.message,
      }, { status: 404 });
    }

    steps.originalEvent = {
      id: calEvent.id,
      title: calEvent.title,
      lead_id: calEvent.lead_id,
      attendees: calEvent.attendees,
    };

    // ── Step 2: Add new attendee to the attendees array ───────────────
    const currentAttendees = (calEvent.attendees as Array<{ email: string; name?: string }>) ?? [];
    const alreadyPresent = currentAttendees.some(
      (a) => a.email.toLowerCase() === NEW_ATTENDEE_EMAIL.toLowerCase()
    );

    if (!alreadyPresent) {
      const updatedAttendees = [
        ...currentAttendees,
        { email: NEW_ATTENDEE_EMAIL, name: NEW_ATTENDEE_NAME },
      ];

      const { error: updateErr } = await db
        .from("calendar_events")
        .update({ attendees: updatedAttendees, updated_at: new Date().toISOString() })
        .eq("id", CAL_EVENT_ID);

      steps.addAttendee = updateErr
        ? { status: "error", error: updateErr.message }
        : { status: "added", attendees: updatedAttendees };
    } else {
      steps.addAttendee = { status: "already_present" };
    }

    // ── Step 3: Pipeline email match ──────────────────────────────────
    const { data: pipelineMatch } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, company_name, contact_email")
      .eq("workspace_id", WORKSPACE_ID)
      .ilike("contact_email", NEW_ATTENDEE_EMAIL)
      .limit(1)
      .maybeSingle();

    steps.pipelineEmailMatch = pipelineMatch
      ? { matched: true, id: pipelineMatch.id, name: pipelineMatch.contact_name, company: pipelineMatch.company_name }
      : { matched: false, email: NEW_ATTENDEE_EMAIL };

    // ── Step 4: Domain match ──────────────────────────────────────────
    const domain = NEW_ATTENDEE_EMAIL.split("@")[1]?.toLowerCase();
    let domainMatch: { id: string; company_name: string; contact_email: string } | null = null;

    if (domain) {
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("id, company_name, contact_email")
        .eq("workspace_id", WORKSPACE_ID)
        .ilike("contact_email", `%@${domain}`)
        .limit(1)
        .maybeSingle();
      domainMatch = data;
    }

    steps.domainMatch = domainMatch
      ? { matched: true, domain, company: domainMatch.company_name, matchedVia: domainMatch.contact_email }
      : { matched: false, domain };

    // ── Step 5: Insert health signal for new attendee ─────────────────
    const leadId = calEvent.lead_id ?? domainMatch?.id ?? null;

    if (domainMatch || leadId) {
      const { data: existingSignal } = await db
        .from("meeting_health_signals")
        .select("id")
        .eq("event_id", CAL_EVENT_ID)
        .eq("signal_type", "new_attendee")
        .limit(1)
        .maybeSingle();

      if (existingSignal) {
        steps.healthSignal = { status: "already_exists", id: existingSignal.id };
      } else {
        const { data: signal, error: sigErr } = await db
          .from("meeting_health_signals")
          .insert({
            workspace_id: WORKSPACE_ID,
            lead_id: leadId,
            signal_type: "new_attendee",
            severity: "info",
            event_id: CAL_EVENT_ID,
            details: {
              email: NEW_ATTENDEE_EMAIL,
              name: NEW_ATTENDEE_NAME,
              matched_company: domainMatch?.company_name ?? null,
              message: `New attendee ${NEW_ATTENDEE_NAME} (${NEW_ATTENDEE_EMAIL}) from ${domainMatch?.company_name ?? domain} added to meeting.`,
            },
          })
          .select("id")
          .single();

        steps.healthSignal = sigErr
          ? { status: "error", error: sigErr.message }
          : { status: "created", id: signal?.id };
      }
    } else {
      steps.healthSignal = { status: "skipped_no_lead_id" };
    }

    // ── Step 6: Enrich attendee ───────────────────────────────────────
    let enrichment;
    try {
      enrichment = await enrichAttendee(NEW_ATTENDEE_EMAIL, NEW_ATTENDEE_NAME);
      steps.enrichment = { status: "ok", result: enrichment };
    } catch (err: unknown) {
      const e = err as { message?: string };
      steps.enrichment = { status: "error", message: e.message };
      enrichment = {
        email: NEW_ATTENDEE_EMAIL,
        name: NEW_ATTENDEE_NAME,
        title: null,
        company: domain ? domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1) : null,
        linkedin_url: null,
        phone: null,
        source: "fallback",
      };
    }

    // ── Step 7: Get lead context for notification ─────────────────────
    let leadName = "a lead";
    if (leadId) {
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("contact_name")
        .eq("id", leadId)
        .single();
      if (pipeline) leadName = pipeline.contact_name;
    }

    steps.leadContext = { leadId, leadName };

    // ── Step 8: Dispatch notification ─────────────────────────────────
    const parts = [enrichment.name ?? NEW_ATTENDEE_EMAIL];
    if (enrichment.title) parts.push(enrichment.title);
    if (enrichment.company) parts.push(`at ${enrichment.company}`);
    const description = parts.join(", ");

    try {
      await dispatchNotification(db, {
        workspaceId: WORKSPACE_ID,
        eventType: "new_attendee_detected",
        pipelineId: leadId ?? undefined,
        title: `New attendee on meeting with ${leadName}`,
        body: `${description} was added to "${calEvent.title ?? "a meeting"}".${
          enrichment.linkedin_url ? ` LinkedIn: ${enrichment.linkedin_url}` : ""
        }${
          domainMatch ? ` Domain matches company: ${domainMatch.company_name}.` : ""
        } Should I add them as a contact?`,
        metadata: {
          calendarEventId: CAL_EVENT_ID,
          enrichment,
        },
      });
      steps.notification = { status: "dispatched" };
    } catch (err: unknown) {
      steps.notification = { status: "error", message: (err as { message?: string }).message };
    }

    return NextResponse.json({
      status: "ok",
      summary: {
        attendeeAdded: NEW_ATTENDEE_EMAIL,
        pipelineEmailMatch: !!pipelineMatch,
        domainMatch: !!domainMatch,
        matchedCompany: domainMatch?.company_name ?? null,
        enrichmentSource: enrichment.source,
        enrichedCompany: enrichment.company,
        notificationSent: true,
        leadName,
      },
      steps,
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({
      steps,
      error: e.message,
      stack: e.stack?.split("\n").slice(0, 8),
    }, { status: 500 });
  }
}

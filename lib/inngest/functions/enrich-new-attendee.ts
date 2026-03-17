/**
 * Enrich New Attendee — Stage 13, Part J
 *
 * Background enrichment for unknown meeting attendees.
 * Uses Apollo.io or domain research, then notifies the user.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { enrichAttendee } from "@/lib/skyler/calendar/attendee-intelligence";
import { dispatchNotification } from "@/lib/skyler/notifications";

export const enrichNewAttendee = inngest.createFunction(
  { id: "skyler-enrich-new-attendee", retries: 2 },
  { event: "skyler/attendee.enrich" },
  async ({ event, step }) => {
    const { workspaceId, calendarEventId, email, name } = event.data as {
      workspaceId: string;
      calendarEventId: string;
      email: string;
      name?: string;
    };

    const result = await step.run("enrich", async () => {
      return enrichAttendee(email, name);
    });

    await step.run("notify-and-store", async () => {
      const db = createAdminSupabaseClient();

      // Get the calendar event for context
      const { data: calEvent } = await db
        .from("calendar_events")
        .select("title, lead_id")
        .eq("id", calendarEventId)
        .single();

      const leadId = calEvent?.lead_id;

      // Build notification message
      const parts = [result.name ?? email];
      if (result.title) parts.push(result.title);
      if (result.company) parts.push(`at ${result.company}`);
      const description = parts.join(", ");

      // Find the pipeline record to get lead name
      let leadName = "a lead";
      if (leadId) {
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("contact_name")
          .eq("id", leadId)
          .single();
        if (pipeline) leadName = pipeline.contact_name;
      }

      // Notify user
      await dispatchNotification(db, {
        workspaceId,
        eventType: "new_attendee_detected",
        pipelineId: leadId ?? undefined,
        title: `New attendee on meeting with ${leadName}`,
        body: `${description} was added to "${calEvent?.title ?? "a meeting"}". ${
          result.linkedin_url ? `LinkedIn: ${result.linkedin_url}` : ""
        } Should I add them as a contact?`,
        metadata: {
          calendarEventId,
          enrichment: result,
        },
      });

      // Log to CRM
      await inngest.send({
        name: "skyler/crm.log-activity",
        data: {
          workspace_id: workspaceId,
          lead_id: leadId,
          activity_type: "contact_enriched",
          payload: {
            email,
            enrichment: result,
          },
        },
      });
    });

    return { email, enrichment: result };
  }
);

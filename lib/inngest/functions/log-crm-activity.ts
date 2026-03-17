/**
 * CRM Activity Logger — Stage 13, Part K
 *
 * Background Inngest function that logs every Skyler action to HubSpot.
 * Fire-and-forget: never blocks main workflows. Silently skips if HubSpot
 * is not connected.
 *
 * 15 activity types covering meetings, emails, pipeline, contacts, and intelligence.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";
import crypto from "crypto";

type CRMActivityType =
  | "meeting_booked"
  | "meeting_completed"
  | "meeting_cancelled"
  | "meeting_rescheduled"
  | "meeting_no_show"
  | "email_sent"
  | "email_reply_received"
  | "stage_changed"
  | "lead_qualified"
  | "lead_disqualified"
  | "new_contact_created"
  | "contact_enriched"
  | "health_signal_detected"
  | "escalation_logged"
  | "task_from_meeting";

export const logCRMActivity = inngest.createFunction(
  {
    id: "skyler-log-crm-activity",
    retries: 3,
    // Batch CRM writes to reduce API calls
    batchEvents: { maxSize: 10, timeout: "5s" },
  },
  { event: "skyler/crm.log-activity" },
  async ({ events, step }) => {
    // Process each event in the batch
    const results = await step.run("process-batch", async () => {
      const db = createAdminSupabaseClient();
      const processedResults: Array<{
        activityType: string;
        status: string;
        reason?: string;
      }> = [];

      for (const evt of events) {
        const {
          workspace_id: workspaceId,
          lead_id: leadId,
          activity_type: activityType,
          payload,
        } = evt.data as {
          workspace_id: string;
          lead_id?: string;
          activity_type: CRMActivityType;
          hubspot_object_type?: string;
          hubspot_object_id?: string;
          action?: string;
          payload: Record<string, unknown>;
        };

        try {
          // Check if HubSpot is connected
          const { data: integration } = await db
            .from("integrations")
            .select("id, nango_connection_id")
            .eq("workspace_id", workspaceId)
            .eq("provider", "hubspot")
            .eq("status", "connected")
            .limit(1)
            .single();

          if (!integration) {
            processedResults.push({
              activityType,
              status: "skipped",
              reason: "hubspot_not_connected",
            });
            continue;
          }

          // Dedup check
          const hash = generateActivityHash(workspaceId, leadId, activityType, payload);
          const { data: existing } = await db
            .from("crm_activity_log")
            .select("id")
            .eq("activity_hash", hash)
            .eq("workspace_id", workspaceId)
            .limit(1);

          if (existing?.length) {
            processedResults.push({
              activityType,
              status: "skipped",
              reason: "duplicate",
            });
            continue;
          }

          // Resolve HubSpot contact ID from pipeline record
          let hubspotContactId: string | null = null;
          if (leadId) {
            const { data: pipeline } = await db
              .from("skyler_sales_pipeline")
              .select("hubspot_contact_id, contact_email")
              .eq("id", leadId)
              .single();

            hubspotContactId =
              (pipeline?.hubspot_contact_id as string) ?? null;

            // If no HubSpot contact ID stored, try to find by email
            if (!hubspotContactId && pipeline?.contact_email) {
              hubspotContactId = await findHubSpotContactByEmail(
                integration.nango_connection_id ?? workspaceId,
                pipeline.contact_email
              );
            }
          }

          // Create the HubSpot record based on activity type
          const noteContent = formatActivityNote(activityType, payload);

          if (noteContent && hubspotContactId) {
            await createHubSpotNote(
              integration.nango_connection_id ?? workspaceId,
              hubspotContactId,
              noteContent
            );
          }

          // Log to dedup table
          await db.from("crm_activity_log").insert({
            workspace_id: workspaceId,
            lead_id: leadId,
            activity_type: activityType,
            activity_hash: hash,
            hubspot_object_id: hubspotContactId,
          });

          processedResults.push({ activityType, status: "logged" });
        } catch (err) {
          console.error(
            `[crm-activity] Failed to log ${activityType}:`,
            err
          );
          processedResults.push({
            activityType,
            status: "error",
            reason: err instanceof Error ? err.message : "unknown",
          });
        }
      }

      return processedResults;
    });

    return { results };
  }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateActivityHash(
  workspaceId: string,
  leadId: string | undefined,
  activityType: string,
  payload: Record<string, unknown>
): string {
  const now = new Date();
  // Round to minute for dedup window
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  const raw = `${workspaceId}:${leadId ?? ""}:${activityType}:${minuteKey}:${JSON.stringify(payload).slice(0, 200)}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function formatActivityNote(
  activityType: CRMActivityType,
  payload: Record<string, unknown>
): string | null {
  const title = ACTIVITY_TITLES[activityType] ?? activityType;
  const body = payload.body ?? payload.message ?? payload.reason ?? "";
  const details = Object.entries(payload)
    .filter(([k]) => !["body", "message"].includes(k))
    .map(([k, v]) => `• ${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");

  return `**[Skyler AI] ${title}**\n\n${body ? body + "\n\n" : ""}${details}`;
}

const ACTIVITY_TITLES: Record<string, string> = {
  meeting_booked: "Meeting Booked",
  meeting_completed: "Meeting Completed",
  meeting_cancelled: "Meeting Cancelled",
  meeting_rescheduled: "Meeting Rescheduled",
  meeting_no_show: "No-Show Detected",
  email_sent: "Email Sent",
  email_reply_received: "Reply Received",
  stage_changed: "Pipeline Stage Changed",
  lead_qualified: "Lead Qualified",
  lead_disqualified: "Lead Disqualified",
  new_contact_created: "New Contact Created",
  contact_enriched: "Contact Enriched",
  health_signal_detected: "Meeting Pattern Alert",
  escalation_logged: "Escalation",
  task_from_meeting: "Action Item from Meeting",
};

// ── HubSpot API calls via Nango proxy ────────────────────────────────────────

async function findHubSpotContactByEmail(
  connectionId: string,
  email: string
): Promise<string | null> {
  try {
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    const resp = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://api.hubapi.com",
      endpoint: "/crm/v3/objects/contacts/search",
      providerConfigKey: "hubspot",
      connectionId,
      data: {
        filterGroups: [
          {
            filters: [
              { propertyName: "email", operator: "EQ", value: email },
            ],
          },
        ],
        properties: ["email"],
        limit: 1,
      },
    });

    const results = (resp.data as { results?: Array<{ id: string }> })?.results;
    return results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function createHubSpotNote(
  connectionId: string,
  contactId: string,
  content: string
): Promise<void> {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Create note engagement
  await nango.proxy({
    method: "POST",
    baseUrlOverride: "https://api.hubapi.com",
    endpoint: "/crm/v3/objects/notes",
    providerConfigKey: "hubspot",
    connectionId,
    data: {
      properties: {
        hs_note_body: content,
        hs_timestamp: new Date().toISOString(),
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 202, // note-to-contact
            },
          ],
        },
      ],
    },
  });
}

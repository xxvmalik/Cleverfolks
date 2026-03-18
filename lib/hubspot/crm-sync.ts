/**
 * CRM Sync — Log Skyler activity to HubSpot.
 *
 * Fire-and-forget: all functions are wrapped in try/catch and never throw.
 * If HubSpot is not connected or any call fails, the main flow continues.
 *
 * Uses Nango triggerAction for create/update operations and Nango proxy
 * for direct HubSpot API calls (email engagements, associations, search).
 */

import { Nango } from "@nangohq/node";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── HubSpot association type IDs (verified via /crm/v4/associations) ─────────

const ASSOCIATION_TYPES = {
  deal_to_contact: 3,
  note_to_contact: 202,
  note_to_deal: 214,
  email_to_contact: 198,
} as const;

// ── Pipeline stage mapping ──────────────────────────────────────────────────

const STAGE_MAP: Record<string, string> = {
  initial_outreach: "New Inquiry",
  follow_up_1: "Proposal Sent",
  follow_up_2: "Qualification",
  follow_up_3: "Qualification",
  replied: "Negotiation",
  negotiation: "Negotiation",
  demo_booked: "Negotiation",
  closed_won: "Closed Won",
  payment_secured: "Closed Won",
  disqualified: "Closed Lost",
  stalled: "Closed Lost",
  no_response: "Closed Lost",
};

export function mapToHubSpotStage(stage: string): string {
  return STAGE_MAP[stage] ?? "New Inquiry";
}

// ── Connection check ────────────────────────────────────────────────────────

async function getHubSpotConnection(
  workspaceId: string
): Promise<{ connectionId: string; nango: InstanceType<typeof Nango> } | null> {
  try {
    const db = createAdminSupabaseClient();
    const { data } = await db
      .from("integrations")
      .select("nango_connection_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .maybeSingle();

    if (!data?.nango_connection_id) return null;

    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    return { connectionId: data.nango_connection_id, nango };
  } catch {
    return null;
  }
}

// ── Contact lookup / creation ───────────────────────────────────────────────

async function findOrCreateContact(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  email: string,
  name: string,
  companyName?: string
): Promise<string | null> {
  try {
    // Search for existing contact by email
    const searchResp = await nango.proxy({
      method: "POST",
      baseUrlOverride: "https://api.hubapi.com",
      endpoint: "/crm/v3/objects/contacts/search",
      providerConfigKey: "hubspot",
      connectionId,
      data: {
        filterGroups: [{
          filters: [{ propertyName: "email", operator: "EQ", value: email }],
        }],
        limit: 1,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (searchResp as any)?.data?.results ?? [];
    if (results.length > 0) {
      return results[0].id as string;
    }

    // Contact not found — create it
    const nameParts = name.split(/\s+/);
    const firstName = nameParts[0] ?? name;
    const lastName = nameParts.slice(1).join(" ") || undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created: any = await nango.triggerAction("hubspot", connectionId, "create-contact", {
      first_name: firstName,
      last_name: lastName,
      email,
      company: companyName,
      lead_status: "NEW",
    });

    const contactId = created?.id as string | undefined;
    console.log(`[CRM Sync] Created HubSpot contact ${contactId} for ${email}`);
    return contactId ?? null;
  } catch (err) {
    console.error("[CRM Sync] Contact lookup/create failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Stage ID resolution ─────────────────────────────────────────────────────

async function resolveStageId(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  stageLabel: string
): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await nango.triggerAction("hubspot", connectionId, "fetch-pipelines", {});
    const pipelines = result?.pipelines ?? [];
    const lower = stageLabel.toLowerCase().trim();

    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages ?? []) {
        if (stage.label && stage.label.toLowerCase().trim() === lower) return stage.id;
      }
    }
    // Fuzzy match
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages ?? []) {
        if (stage.label && stage.label.toLowerCase().includes(lower)) return stage.id;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Association helper ──────────────────────────────────────────────────────

async function associate(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  fromType: string,
  fromId: string,
  toType: string,
  toId: string,
  typeId: number
): Promise<void> {
  try {
    await nango.proxy({
      method: "PUT",
      endpoint: `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
      providerConfigKey: "hubspot",
      connectionId,
      data: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }],
    });
  } catch (err) {
    console.error(`[CRM Sync] Association ${fromType}/${fromId} → ${toType}/${toId} failed:`,
      err instanceof Error ? err.message : String(err));
  }
}

// ── Deal dedup: search HubSpot for existing deal by contact ─────────────────

async function findDealByContact(
  nango: InstanceType<typeof Nango>,
  connectionId: string,
  contactId: string
): Promise<string | null> {
  try {
    // Get deals associated with this contact
    const resp = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://api.hubapi.com",
      endpoint: `/crm/v4/objects/contacts/${contactId}/associations/deals`,
      providerConfigKey: "hubspot",
      connectionId,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (resp as any)?.data?.results ?? [];
    if (results.length > 0) {
      // Return the first (most recent) associated deal
      const dealId = results[0].toObjectId as string;
      return dealId ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CRMSyncParams {
  workspaceId: string;
  contactEmail: string;
  contactName: string;
  companyName?: string;
}

/**
 * Log an email activity to HubSpot and associate it with the contact.
 * Fire-and-forget — never throws.
 */
export async function logEmailToHubSpot(params: CRMSyncParams & {
  subject: string;
  body: string;
  direction: "SENT" | "RECEIVED";
  timestamp: string;
}): Promise<void> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return;

    const contactId = await findOrCreateContact(
      conn.nango, conn.connectionId, params.contactEmail, params.contactName, params.companyName
    );

    // Create email engagement via HubSpot v3 API
    const emailResp = await conn.nango.proxy({
      method: "POST",
      baseUrlOverride: "https://api.hubapi.com",
      endpoint: "/crm/v3/objects/emails",
      providerConfigKey: "hubspot",
      connectionId: conn.connectionId,
      data: {
        properties: {
          hs_timestamp: params.timestamp,
          hs_email_direction: params.direction === "SENT" ? "EMAIL" : "INCOMING_EMAIL",
          hs_email_subject: params.subject,
          hs_email_text: params.body.slice(0, 10000),
          hs_email_status: "SENT",
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailId = (emailResp as any)?.data?.id;
    if (emailId && contactId) {
      await associate(conn.nango, conn.connectionId, "emails", emailId, "contacts", contactId, ASSOCIATION_TYPES.email_to_contact);
    }

    console.log(`[CRM Sync] Logged ${params.direction} email to HubSpot: "${params.subject}"`);
  } catch (err) {
    console.error("[CRM Sync] logEmailToHubSpot failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Create or update a deal in HubSpot for this pipeline contact.
 * Returns the deal ID if successful, or null.
 *
 * DEDUP: Before creating a new deal, this function:
 *   1. Re-reads hubspot_deal_id from the DB (fresh, not stale params)
 *   2. Searches HubSpot for existing deals associated with the contact email
 * This prevents the duplicate-deal bug where concurrent callers each create a deal.
 *
 * Fire-and-forget — never throws.
 */
export async function syncDealToHubSpot(params: CRMSyncParams & {
  pipelineStage: string;
  hubspotDealId?: string | null;
  pipelineId?: string | null;
}): Promise<string | null> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return null;

    const stageId = await resolveStageId(conn.nango, conn.connectionId, params.pipelineStage);

    // ── Layer 1: Check stale param ──────────────────────────────────────
    let dealId = params.hubspotDealId ?? null;

    // ── Layer 2: Fresh DB read (another caller may have written it) ─────
    if (!dealId && params.pipelineId) {
      const db = createAdminSupabaseClient();
      const { data: fresh } = await db
        .from("skyler_sales_pipeline")
        .select("hubspot_deal_id")
        .eq("id", params.pipelineId)
        .maybeSingle();
      if (fresh?.hubspot_deal_id) {
        dealId = fresh.hubspot_deal_id as string;
        console.log(`[CRM Sync] Found deal ${dealId} via fresh DB read (avoiding duplicate)`);
      }
    }

    // If we have an existing deal ID, update it
    if (dealId) {
      const payload: Record<string, unknown> = { id: dealId };
      if (stageId) payload.deal_stage = stageId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await conn.nango.triggerAction("hubspot", conn.connectionId, "update-deal", payload);
      console.log(`[CRM Sync] Updated deal ${dealId} → stage "${params.pipelineStage}"`);
      return dealId;
    }

    // ── Layer 3: Search HubSpot for existing deal by contact ────────────
    const contactId = await findOrCreateContact(
      conn.nango, conn.connectionId, params.contactEmail, params.contactName, params.companyName
    );

    if (contactId) {
      const existingDealId = await findDealByContact(conn.nango, conn.connectionId, contactId);
      if (existingDealId) {
        console.log(`[CRM Sync] Found existing deal ${existingDealId} in HubSpot for contact ${contactId} (avoiding duplicate)`);
        // Update the stage on the existing deal
        const payload: Record<string, unknown> = { id: existingDealId };
        if (stageId) payload.deal_stage = stageId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await conn.nango.triggerAction("hubspot", conn.connectionId, "update-deal", payload).catch(() => {});

        // Store the deal ID on the pipeline record so future calls skip the search
        if (params.pipelineId) {
          const db = createAdminSupabaseClient();
          await db
            .from("skyler_sales_pipeline")
            .update({ hubspot_deal_id: existingDealId, crm_synced: true, updated_at: new Date().toISOString() })
            .eq("id", params.pipelineId);
        }
        return existingDealId;
      }
    }

    // No existing deal anywhere — create one
    const dealPayload: Record<string, unknown> = {
      name: `${params.contactName} - Skyler Outreach`,
    };
    if (stageId) dealPayload.deal_stage = stageId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created: any = await conn.nango.triggerAction("hubspot", conn.connectionId, "create-deal", dealPayload);
    const newDealId = created?.id as string | undefined;

    if (newDealId && contactId) {
      await associate(conn.nango, conn.connectionId, "deals", newDealId, "contacts", contactId, ASSOCIATION_TYPES.deal_to_contact);
    }

    // Immediately persist deal ID to prevent race with other callers
    if (newDealId && params.pipelineId) {
      const db = createAdminSupabaseClient();
      await db
        .from("skyler_sales_pipeline")
        .update({ hubspot_deal_id: newDealId, crm_synced: true, updated_at: new Date().toISOString() })
        .eq("id", params.pipelineId);
      console.log(`[CRM Sync] Created deal ${newDealId} and stored on pipeline ${params.pipelineId}`);
    } else {
      console.log(`[CRM Sync] Created deal ${newDealId} for ${params.contactEmail} → "${params.pipelineStage}"`);
    }

    return newDealId ?? null;
  } catch (err) {
    console.error("[CRM Sync] syncDealToHubSpot failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Add a note to a HubSpot contact (and optionally a deal).
 * Fire-and-forget — never throws.
 */
export async function addNoteToHubSpot(params: CRMSyncParams & {
  note: string;
  hubspotDealId?: string | null;
}): Promise<void> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return;

    const contactId = await findOrCreateContact(
      conn.nango, conn.connectionId, params.contactEmail, params.contactName, params.companyName
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created: any = await conn.nango.triggerAction("hubspot", conn.connectionId, "create-note", {
      hs_note_body: params.note,
      hs_timestamp: new Date().toISOString(),
    });

    const noteId = created?.id as string | undefined;
    if (noteId && contactId) {
      await associate(conn.nango, conn.connectionId, "notes", noteId, "contacts", contactId, ASSOCIATION_TYPES.note_to_contact);
    }
    if (noteId && params.hubspotDealId) {
      await associate(conn.nango, conn.connectionId, "notes", noteId, "deals", params.hubspotDealId, ASSOCIATION_TYPES.note_to_deal);
    }

    console.log(`[CRM Sync] Added note to HubSpot: "${params.note.substring(0, 80)}"`);
  } catch (err) {
    console.error("[CRM Sync] addNoteToHubSpot failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Full CRM sync after an email is sent. Logs email, syncs deal, adds note.
 * Stores hubspot_deal_id on the pipeline record for future updates.
 * Fire-and-forget — never throws.
 */
export async function syncEmailSentToHubSpot(params: {
  workspaceId: string;
  pipelineId: string;
  contactEmail: string;
  contactName: string;
  companyName?: string;
  subject: string;
  body: string;
  cadenceStep: number;
  pipelineStage: string;
  hubspotDealId?: string | null;
}): Promise<void> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return;

    // Sync deal first (with dedup), then log email + note in parallel
    // Sequential deal sync prevents race conditions
    await syncDealToHubSpot({
      workspaceId: params.workspaceId,
      contactEmail: params.contactEmail,
      contactName: params.contactName,
      companyName: params.companyName,
      pipelineStage: mapToHubSpotStage(params.pipelineStage),
      hubspotDealId: params.hubspotDealId,
      pipelineId: params.pipelineId,
    });

    // Log email + note in parallel (deal ID persistence is handled by syncDealToHubSpot)
    await Promise.all([
      logEmailToHubSpot({
        workspaceId: params.workspaceId,
        contactEmail: params.contactEmail,
        contactName: params.contactName,
        companyName: params.companyName,
        subject: params.subject,
        body: params.body,
        direction: "SENT",
        timestamp: new Date().toISOString(),
      }),
      addNoteToHubSpot({
        workspaceId: params.workspaceId,
        contactEmail: params.contactEmail,
        contactName: params.contactName,
        note: `Skyler sent outreach email (step ${params.cadenceStep}): "${params.subject}"`,
        hubspotDealId: params.hubspotDealId,
      }),
    ]);
  } catch (err) {
    console.error("[CRM Sync] syncEmailSentToHubSpot failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Full CRM sync after a prospect reply is detected.
 * Fire-and-forget — never throws.
 */
export async function syncReplyToHubSpot(params: {
  workspaceId: string;
  pipelineId: string;
  contactEmail: string;
  contactName: string;
  companyName?: string;
  replyContent: string;
  intent: string;
  hubspotDealId?: string | null;
}): Promise<void> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return;

    // Sync deal first (with dedup), then log email + note in parallel
    await syncDealToHubSpot({
      workspaceId: params.workspaceId,
      contactEmail: params.contactEmail,
      contactName: params.contactName,
      companyName: params.companyName,
      pipelineStage: "Negotiation",
      hubspotDealId: params.hubspotDealId,
      pipelineId: params.pipelineId,
    });

    await Promise.all([
      logEmailToHubSpot({
        workspaceId: params.workspaceId,
        contactEmail: params.contactEmail,
        contactName: params.contactName,
        companyName: params.companyName,
        subject: "re: outreach",
        body: params.replyContent,
        direction: "RECEIVED",
        timestamp: new Date().toISOString(),
      }),
      addNoteToHubSpot({
        workspaceId: params.workspaceId,
        contactEmail: params.contactEmail,
        contactName: params.contactName,
        note: `Prospect replied (${params.intent}): "${params.replyContent.substring(0, 100)}"`,
        hubspotDealId: params.hubspotDealId,
      }),
    ]);
  } catch (err) {
    console.error("[CRM Sync] syncReplyToHubSpot failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Full CRM sync when a lead is closed/resolved.
 * Fire-and-forget — never throws.
 */
export async function syncResolutionToHubSpot(params: {
  workspaceId: string;
  pipelineId?: string;
  contactEmail: string;
  contactName: string;
  companyName?: string;
  resolution: string;
  hubspotDealId?: string | null;
}): Promise<void> {
  try {
    const conn = await getHubSpotConnection(params.workspaceId);
    if (!conn) return;

    // Sync deal first (with dedup), then note
    await syncDealToHubSpot({
      workspaceId: params.workspaceId,
      contactEmail: params.contactEmail,
      contactName: params.contactName,
      companyName: params.companyName,
      pipelineStage: mapToHubSpotStage(params.resolution),
      hubspotDealId: params.hubspotDealId,
      pipelineId: params.pipelineId,
    });

    await addNoteToHubSpot({
      workspaceId: params.workspaceId,
      contactEmail: params.contactEmail,
      contactName: params.contactName,
      note: `Lead closed: ${params.resolution}`,
      hubspotDealId: params.hubspotDealId,
    });
  } catch (err) {
    console.error("[CRM Sync] syncResolutionToHubSpot failed:", err instanceof Error ? err.message : String(err));
  }
}

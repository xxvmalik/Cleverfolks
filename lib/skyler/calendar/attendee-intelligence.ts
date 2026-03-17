/**
 * Attendee Intelligence — Stage 13, Part J
 *
 * Matches meeting attendees against CRM/pipeline, enriches unknowns,
 * and surfaces new attendee alerts.
 */

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { inngest } from "@/lib/inngest/client";

type Attendee = {
  email: string;
  name?: string;
  response_status?: string;
  role?: string;
};

type EnrichmentResult = {
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  phone: string | null;
  source: string;
};

// ── Match attendees against pipeline/CRM ─────────────────────────────────────

/**
 * Process attendees for a calendar event. For each:
 * 1. Match by email against pipeline
 * 2. Match by domain against company records
 * 3. Flag unknowns and trigger enrichment
 */
export async function processEventAttendees(
  workspaceId: string,
  calendarEventId: string,
  attendees: Attendee[]
): Promise<void> {
  const db = createAdminSupabaseClient();

  for (const attendee of attendees) {
    if (!attendee.email) continue;

    // Skip the organizer's own email
    const { data: connections } = await db
      .from("calendar_connections")
      .select("provider_email")
      .eq("workspace_id", workspaceId);

    const orgEmails = new Set(
      (connections ?? []).map((c) => c.provider_email?.toLowerCase()).filter(Boolean)
    );
    if (orgEmails.has(attendee.email.toLowerCase())) continue;

    // Try exact email match against pipeline
    const { data: pipelineMatch } = await db
      .from("skyler_sales_pipeline")
      .select("id, contact_name, company_name")
      .eq("workspace_id", workspaceId)
      .ilike("contact_email", attendee.email)
      .limit(1)
      .single();

    if (pipelineMatch) {
      // Known contact — no action needed
      continue;
    }

    // Try domain match against known companies
    const domain = attendee.email.split("@")[1]?.toLowerCase();
    if (domain && !isGenericDomain(domain)) {
      const { data: companyMatch } = await db
        .from("skyler_sales_pipeline")
        .select("id, company_name")
        .eq("workspace_id", workspaceId)
        .ilike("contact_email", `%@${domain}`)
        .limit(1)
        .single();

      if (companyMatch) {
        // New attendee from known company — flag as new stakeholder
        await db.from("meeting_health_signals").insert({
          workspace_id: workspaceId,
          lead_id: companyMatch.id,
          signal_type: "new_attendee",
          severity: "info",
          event_id: calendarEventId,
          details: {
            email: attendee.email,
            name: attendee.name,
            matched_company: companyMatch.company_name,
            message: `New attendee ${attendee.name ?? attendee.email} from ${companyMatch.company_name} added to meeting.`,
          },
        });
      }
    }

    // Trigger background enrichment for unknown attendees
    await inngest.send({
      name: "skyler/attendee.enrich",
      data: {
        workspaceId,
        calendarEventId,
        email: attendee.email,
        name: attendee.name,
      },
    });
  }
}

// ── Enrichment (background Inngest job) ──────────────────────────────────────

/**
 * Enrich an unknown attendee. Tries Apollo.io first, falls back to domain research.
 */
export async function enrichAttendee(
  email: string,
  name?: string
): Promise<EnrichmentResult> {
  // Try Apollo.io (free tier: 10,000 credits/month)
  if (process.env.APOLLO_API_KEY) {
    try {
      const resp = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.APOLLO_API_KEY,
        },
        body: JSON.stringify({ email }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          person?: {
            name: string;
            title: string;
            organization_name: string;
            linkedin_url: string;
            phone_numbers?: Array<{ sanitized_number: string }>;
          };
        };

        if (data.person) {
          return {
            email,
            name: data.person.name ?? name ?? null,
            title: data.person.title ?? null,
            company: data.person.organization_name ?? null,
            linkedin_url: data.person.linkedin_url ?? null,
            phone: data.person.phone_numbers?.[0]?.sanitized_number ?? null,
            source: "apollo",
          };
        }
      }
    } catch (err) {
      console.error("[attendee-intelligence] Apollo enrichment failed:", err);
    }
  }

  // Fallback: basic domain-based info
  const domain = email.split("@")[1];
  return {
    email,
    name: name ?? null,
    title: null,
    company: domain ? domainToCompanyName(domain) : null,
    linkedin_url: null,
    phone: null,
    source: "domain_inference",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GENERIC_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "aol.com", "protonmail.com", "mail.com", "zoho.com",
]);

function isGenericDomain(domain: string): boolean {
  return GENERIC_DOMAINS.has(domain.toLowerCase());
}

function domainToCompanyName(domain: string): string {
  // Simple heuristic: capitalize the domain name part
  const parts = domain.split(".");
  const name = parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

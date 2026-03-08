/**
 * Resend webhook handler.
 * Receives email events (sent, delivered, opened, clicked, bounced, complained)
 * and updates skyler_sales_pipeline + skyler_email_events accordingly.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type ResendWebhookPayload = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from?: string;
    to?: string[];
    subject?: string;
  };
};

// Map Resend event types to our event type names
const EVENT_TYPE_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(req: NextRequest) {
  let payload: ResendWebhookPayload;
  try {
    payload = (await req.json()) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = EVENT_TYPE_MAP[payload.type];
  if (!eventType) {
    // Unknown event type, acknowledge but ignore
    return NextResponse.json({ ok: true });
  }

  const resendEmailId = payload.data?.email_id;
  if (!resendEmailId) {
    return NextResponse.json({ error: "Missing email_id" }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  // Find the pipeline record by resend email ID
  const { data: pipeline } = await db
    .from("skyler_sales_pipeline")
    .select("id, workspace_id, emails_opened, emails_clicked, emails_replied")
    .eq("last_email_resend_id", resendEmailId)
    .single();

  if (!pipeline) {
    // Could be from a different email, or pipeline already resolved
    console.log(`[resend-webhook] No pipeline found for resend_id=${resendEmailId}`);
    return NextResponse.json({ ok: true });
  }

  // Store the event
  await db.from("skyler_email_events").insert({
    workspace_id: pipeline.workspace_id,
    pipeline_id: pipeline.id,
    resend_email_id: resendEmailId,
    event_type: eventType,
    event_data: payload.data,
  });

  // Update pipeline counters based on event type
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (eventType === "opened") {
    updates.emails_opened = (pipeline.emails_opened ?? 0) + 1;
  } else if (eventType === "clicked") {
    updates.emails_clicked = (pipeline.emails_clicked ?? 0) + 1;
  } else if (eventType === "bounced") {
    // Flag as problem -- email didn't reach the contact
    updates.stage = "stalled";
    updates.resolution_notes = "Email bounced -- invalid or inactive address";
    console.warn(`[resend-webhook] Email bounced for pipeline ${pipeline.id}`);
  }

  await db
    .from("skyler_sales_pipeline")
    .update(updates)
    .eq("id", pipeline.id);

  console.log(`[resend-webhook] ${eventType} event for pipeline ${pipeline.id}`);
  return NextResponse.json({ ok: true });
}

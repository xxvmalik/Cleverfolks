/**
 * PATCH /api/skyler/lead-alerts/{id}/dismiss
 *
 * Dismisses an alert — marks notification as read or health signal as acknowledged.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  // Try marking as read in notifications first
  const { data: notif } = await db
    .from("skyler_notifications")
    .update({ read: true })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (notif) {
    return NextResponse.json({ ok: true, source: "notification" });
  }

  // If not found in notifications, try health signals
  const { data: signal } = await db
    .from("meeting_health_signals")
    .update({ acknowledged: true })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (signal) {
    return NextResponse.json({ ok: true, source: "health_signal" });
  }

  return NextResponse.json({ error: "Alert not found" }, { status: 404 });
}

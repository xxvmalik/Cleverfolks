/**
 * GET — Fetch notifications for a workspace (with optional unread filter).
 * PATCH — Mark notification(s) as read.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20"), 50);

  const db = createAdminSupabaseClient();

  // Fetch notifications
  let query = db
    .from("skyler_notifications")
    .select("id, event_type, pipeline_id, title, body, metadata, read, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("read", false);
  }

  const { data: notifications, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get unread count
  const { count } = await db
    .from("skyler_notifications")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("read", false);

  return NextResponse.json({
    notifications: notifications ?? [],
    unreadCount: count ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { workspaceId, notificationIds, markAllRead } = body as {
    workspaceId: string;
    notificationIds?: string[];
    markAllRead?: boolean;
  };

  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const db = createAdminSupabaseClient();

  if (markAllRead) {
    // Mark all unread notifications as read for this workspace
    const { error } = await db
      .from("skyler_notifications")
      .update({ read: true })
      .eq("workspace_id", workspaceId)
      .eq("read", false);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (notificationIds && notificationIds.length > 0) {
    // Mark specific notifications as read
    const { error } = await db
      .from("skyler_notifications")
      .update({ read: true })
      .eq("workspace_id", workspaceId)
      .in("id", notificationIds);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "notificationIds or markAllRead required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

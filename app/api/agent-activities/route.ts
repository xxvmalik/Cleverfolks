/**
 * GET /api/agent-activities
 *
 * Returns agent activities for the workspace. Supports filtering by:
 * - agentType (skyler, cleverbrain)
 * - activityType (email_drafted, email_sent, etc.)
 * - after/before (ISO date strings)
 * - limit (default 50, max 200)
 * - offset (for pagination)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get workspace from user's memberships
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const workspaceId = membership.workspace_id;
  const params = req.nextUrl.searchParams;
  const agentType = params.get("agentType");
  const activityType = params.get("activityType");
  const after = params.get("after");
  const before = params.get("before");
  const limit = Math.min(Number(params.get("limit") ?? 50), 200);
  const offset = Number(params.get("offset") ?? 0);

  const db = createAdminSupabaseClient();

  let query = db
    .from("agent_activities")
    .select("id, agent_type, activity_type, title, description, metadata, related_entity_id, related_entity_type, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (agentType) query = query.eq("agent_type", agentType);
  if (activityType) query = query.eq("activity_type", activityType);
  if (after) query = query.gte("created_at", after);
  if (before) query = query.lte("created_at", before);

  const { data, error } = await query;

  if (error) {
    console.warn("[agent-activities] Query error:", error.message);
    return NextResponse.json({ activities: [] });
  }

  return NextResponse.json({ activities: data ?? [] });
}

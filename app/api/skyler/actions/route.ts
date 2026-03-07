import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  executeApprovedAction,
  rejectAction,
} from "@/lib/skyler/tool-handlers";

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { actionId, action: actionType, workspaceId } = body as {
    actionId?: string;
    action?: "approve" | "reject";
    workspaceId?: string;
  };

  if (!actionId || !actionType || !workspaceId) {
    return NextResponse.json(
      { error: "actionId, action, and workspaceId are required" },
      { status: 400 }
    );
  }

  // Verify workspace membership
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createAdminSupabaseClient();

  if (actionType === "approve") {
    const result = await executeApprovedAction(actionId, db);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Execution failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, status: "executed" });
  }

  if (actionType === "reject") {
    const result = await rejectAction(actionId, db);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Rejection failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// GET pending actions for a conversation
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminSupabaseClient();

  const statusFilter = req.nextUrl.searchParams.get("status");

  let query = db
    .from("skyler_actions")
    .select("id, tool_name, tool_input, description, status, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query.limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ actions: data ?? [] });
}

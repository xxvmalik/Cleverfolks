import { NextRequest, NextResponse } from "next/server";
import { Nango } from "@nangohq/node";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { workspaceId: string };
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Verify user is a member of this workspace
    const { data: membership } = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch user profile for display name / email
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    const session = await nango.createConnectSession({
      end_user: {
        id: workspaceId,
        email: profile?.email ?? user.email ?? undefined,
        display_name: profile?.full_name ?? undefined,
      },
      allowed_integrations: ["slack", "google-mail", "outlook"],
    });

    return NextResponse.json({ token: session.data.token });
  } catch (err) {
    console.error("Nango session creation error:", err);
    return NextResponse.json(
      { error: "Failed to create Nango session" },
      { status: 500 }
    );
  }
}

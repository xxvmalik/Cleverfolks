import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const NANGO_API = "https://api.nango.dev";

/**
 * GET /api/integrations?workspaceId=xxx
 *
 * Returns integration statuses. Cross-checks with Nango to auto-reconcile
 * connections that exist on Nango but are missing or stale in the DB.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Fetch DB integrations
  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("id, provider, status, sync_status, last_synced_at, nango_connection_id")
    .eq("workspace_id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dbIntegrations = integrations ?? [];

  // Cross-check with Nango (best-effort, non-blocking for the response)
  try {
    const nangoSecret = process.env.NANGO_SECRET_KEY;
    if (nangoSecret) {
      const nangoRes = await fetch(
        `${NANGO_API}/connections?end_user_id=${encodeURIComponent(workspaceId)}`,
        {
          headers: { Authorization: `Bearer ${nangoSecret}` },
          next: { revalidate: 0 },
        }
      );

      if (nangoRes.ok) {
        const nangoData = (await nangoRes.json()) as {
          connections: Array<{
            id: string;
            connection_id: string;
            provider_config_key: string;
          }>;
        };

        const nangoConnections = nangoData.connections ?? [];
        const adminDb = createAdminSupabaseClient();

        for (const nc of nangoConnections) {
          const provider = nc.provider_config_key;
          const connectionId = nc.connection_id;
          const dbMatch = dbIntegrations.find((i) => i.provider === provider);

          if (!dbMatch) {
            // Exists on Nango but not in DB — create it
            console.error(`[integrations] Nango has ${provider} connection but DB doesn't — auto-creating`);
            const { data: inserted } = await adminDb
              .from("integrations")
              .insert({
                workspace_id: workspaceId,
                provider,
                status: "connected",
                nango_connection_id: connectionId,
                sync_status: "idle",
              })
              .select("id, provider, status, sync_status, last_synced_at, nango_connection_id")
              .single();
            if (inserted) dbIntegrations.push(inserted);
          } else if (dbMatch.status !== "connected") {
            // Exists in DB but marked disconnected — reconcile
            console.error(`[integrations] Nango has ${provider} connected but DB says ${dbMatch.status} — reconciling`);
            await adminDb
              .from("integrations")
              .update({
                status: "connected",
                nango_connection_id: connectionId,
                sync_status: dbMatch.sync_status ?? "idle",
              })
              .eq("id", dbMatch.id);
            dbMatch.status = "connected";
            dbMatch.nango_connection_id = connectionId;
          } else if (!dbMatch.nango_connection_id && connectionId) {
            // Connected but missing connection ID — fill it in
            await adminDb
              .from("integrations")
              .update({ nango_connection_id: connectionId })
              .eq("id", dbMatch.id);
            dbMatch.nango_connection_id = connectionId;
          }
        }
      }
    }
  } catch (syncErr) {
    // Non-fatal — still return whatever DB has
    console.error("[integrations] Nango cross-check failed:", syncErr instanceof Error ? syncErr.message : syncErr);
  }

  // Strip nango_connection_id from response (internal detail)
  const cleaned = dbIntegrations.map(({ nango_connection_id: _, ...rest }) => rest);
  return NextResponse.json({ integrations: cleaned });
}

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
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

  // ── Fetch deals from synced_documents + document_chunks ──────────────
  // document_chunks.metadata stores: source_type, deal_name, stage, status, amount, probability, owner, etc.
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("id, chunk_text, metadata, document_id")
    .eq("workspace_id", workspaceId)
    .eq("metadata->>source_type", "hubspot_deal")
    .order("created_at", { ascending: false });

  const deals = (chunks ?? []).map((c: { id: string; chunk_text: string; metadata: Record<string, unknown>; document_id: string }) => {
    const m = c.metadata ?? {};
    return {
      id: c.id,
      document_id: c.document_id,
      deal_name: (m.deal_name as string) ?? "Untitled Deal",
      stage: (m.stage as string) ?? "",
      status: (m.status as string) ?? "",
      amount: (m.amount as string) ?? "",
      probability: (m.probability as string) ?? "",
      close_date: (m.close_date as string) ?? "",
      owner: (m.owner as string) ?? "",
      chunk_text: c.chunk_text,
    };
  });

  // ── Compute stats ─────────────────────────────────────────────────────
  const openDeals = deals.filter((d) => d.status === "Open");
  const qualificationDeals = openDeals.filter((d) =>
    d.stage.toLowerCase().includes("qualification")
  );
  const qualificationRate =
    openDeals.length > 0
      ? Math.round((qualificationDeals.length / openDeals.length) * 100)
      : 0;

  const hotLeads = deals.filter((d) =>
    d.stage.toLowerCase().includes("negotiation")
  ).length;

  const nurtureQueue = deals.filter(
    (d) =>
      d.stage.toLowerCase().includes("new inquiry") ||
      d.stage.toLowerCase().includes("qualification")
  ).length;

  const disqualified = deals.filter(
    (d) => d.status === "Closed Lost"
  ).length;

  // ── Build lead cards from open deals ──────────────────────────────────
  const leadCards = openDeals.map((d) => {
    const probNum = parseFloat(d.probability) || 0;
    const priority: "High" | "Medium" | "Low" =
      probNum >= 60 ? "High" : probNum >= 30 ? "Medium" : "Low";

    // Try to extract contact name from chunk_text
    const contactMatch = d.chunk_text.match(/Contact:\s*([^|]+)/i);
    const contactName = contactMatch ? contactMatch[1].trim() : "";

    return {
      id: d.id,
      company: d.deal_name,
      priority,
      potential: d.amount ? `$${Number(d.amount).toLocaleString("en-US")}` : "$0",
      detail: contactName || d.stage || "No details",
      stage: d.stage,
      probability: probNum,
    };
  });

  // ── Connected integrations ────────────────────────────────────────────
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, provider, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected");

  const connectedIntegrations = (integrations ?? []).map((i: { id: string; provider: string; status: string }) => ({
    id: i.id,
    provider: i.provider,
  }));

  // ── Workspace settings (sales closer toggle) ─────────────────────────
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const salesCloserEnabled = settings.skyler_sales_closer === true;

  return NextResponse.json({
    stats: {
      qualificationRate,
      hotLeads,
      nurtureQueue,
      disqualified,
    },
    leads: leadCards,
    connectedIntegrations,
    salesCloserEnabled,
  });
}

// ── PATCH: Update workspace settings ────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { workspaceId, salesCloserEnabled } = body;

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

  // Read current settings, merge the new value
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const currentSettings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const newSettings = { ...currentSettings, skyler_sales_closer: !!salesCloserEnabled };

  const { error } = await supabase
    .from("workspaces")
    .update({ settings: newSettings })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

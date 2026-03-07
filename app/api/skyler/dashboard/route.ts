import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// Default scoring thresholds — overridden by workspace.settings.skyler_scoring_thresholds
const DEFAULT_THRESHOLDS = { high: 60, medium: 30 };

// Map ISO 4217 currency codes to symbols
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥",
  NGN: "₦", INR: "₹", BRL: "R$", ZAR: "R", KRW: "₩",
  AUD: "A$", CAD: "C$", CHF: "CHF", SEK: "kr", NOK: "kr",
  DKK: "kr", MXN: "MX$", AED: "د.إ", SAR: "﷼", TRY: "₺",
  PLN: "zł", CZK: "Kč", HUF: "Ft", RUB: "₽", THB: "฿",
  SGD: "S$", HKD: "HK$", NZD: "NZ$", ILS: "₪", PHP: "₱",
  MYR: "RM", IDR: "Rp", TWD: "NT$", KES: "KSh", GHS: "₵",
  EGP: "E£", COP: "COL$", CLP: "CLP$", ARS: "AR$", PEN: "S/.",
};

function getCurrencySymbol(code: string): string {
  if (!code) return "";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code.toUpperCase() + " ";
}

function parseProbability(raw: string): number {
  if (!raw) return 0;
  // Handle "80%" → 80, "0.8" → 80, "80" → 80
  const cleaned = raw.replace("%", "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  // If stored as decimal (e.g. 0.8), convert to percentage
  if (num > 0 && num <= 1) return Math.round(num * 100);
  return Math.round(num);
}

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

  // ── Fetch deals + workspace settings in parallel ────────────────────────
  // Use admin client for workspace settings to bypass RLS on the settings column
  const adminDb = createAdminSupabaseClient();
  const [{ data: chunks }, { data: workspace }] = await Promise.all([
    supabase
      .from("document_chunks")
      .select("id, chunk_text, metadata, document_id")
      .eq("workspace_id", workspaceId)
      .eq("metadata->>source_type", "hubspot_deal")
      .order("created_at", { ascending: false }),
    adminDb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single(),
  ]);

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;

  // ── Resolve workspace currency ─────────────────────────────────────────
  // Source of truth: workspace.settings.currency (ISO 4217 code set by workspace admin)
  // Deal-level currency_code in metadata is used as override per-deal if available
  const workspaceCurrency = (settings.currency as string) ?? "";

  // ── Scoring thresholds ─────────────────────────────────────────────────
  const customThresholds = settings.skyler_scoring_thresholds as
    | { high?: number; medium?: number }
    | undefined;
  const thresholds = {
    high: customThresholds?.high ?? DEFAULT_THRESHOLDS.high,
    medium: customThresholds?.medium ?? DEFAULT_THRESHOLDS.medium,
  };

  // ── Parse deals ────────────────────────────────────────────────────────
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

  // ── Compute stats ──────────────────────────────────────────────────────
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

  // ── Build lead cards from open deals ───────────────────────────────────
  const leadCards = openDeals.map((d) => {
    // Parse probability — stored as "80%" in metadata, may also be in chunk_text
    let probNum = parseProbability(d.probability);
    if (probNum === 0 && d.chunk_text) {
      const probMatch = d.chunk_text.match(/Probability:\s*([0-9.]+%?)/i);
      if (probMatch) probNum = parseProbability(probMatch[1]);
    }

    const priority: "High" | "Medium" | "Low" =
      probNum >= thresholds.high ? "High" : probNum >= thresholds.medium ? "Medium" : "Low";

    // Currency comes from workspace settings (set automatically from HubSpot account info during sync)
    const symbol = getCurrencySymbol(workspaceCurrency);

    // Format amount with currency
    const amountNum = parseFloat(d.amount) || 0;
    const potential = amountNum > 0
      ? `${symbol}${amountNum.toLocaleString("en-US")}`
      : `${symbol}0`;

    // Extract contact name from chunk_text
    const contactMatch = d.chunk_text.match(/Contact:\s*([^|]+)/i);
    const contactName = contactMatch ? contactMatch[1].trim() : "";

    return {
      id: d.id,
      company: d.deal_name,
      priority,
      potential,
      detail: contactName || d.stage || "No details",
      stage: d.stage,
      probability: probNum,
    };
  });

  // ── Connected integrations ─────────────────────────────────────────────
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, provider, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected");

  const connectedIntegrations = (integrations ?? []).map((i: { id: string; provider: string; status: string }) => ({
    id: i.id,
    provider: i.provider,
  }));

  const salesCloserEnabled = settings.skyler_sales_closer === true;

  return NextResponse.json({
    currency: workspaceCurrency,
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

// ── PATCH: Update workspace settings ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { workspaceId, salesCloserEnabled, currency } = body;

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

  // Read current settings, merge the new value (admin client to bypass RLS)
  const adminDb = createAdminSupabaseClient();
  const { data: workspace } = await adminDb
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  const currentSettings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const newSettings = { ...currentSettings };
  if (salesCloserEnabled !== undefined) newSettings.skyler_sales_closer = !!salesCloserEnabled;
  if (currency !== undefined) newSettings.currency = currency;

  const { error } = await adminDb
    .from("workspaces")
    .update({ settings: newSettings })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

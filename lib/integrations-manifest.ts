/**
 * Integration manifest — maps Nango provider IDs to human-readable descriptions
 * and the source_types they contribute to synced_documents.
 *
 * Adding a new integration requires ONLY adding an entry to PROVIDER_CONFIG.
 * The query planner, strategy executor, and chat route need zero changes.
 */

export type IntegrationInfo = {
  provider: string;
  /** Human-readable display name, e.g. "Gmail" */
  name: string;
  /** Short description of what data this integration provides. */
  description: string;
  /** source_type values written to synced_documents for this integration. */
  sourceTypes: string[];
  /** Regex that detects this integration being mentioned in a user query.
   *  Used by the deterministic intent safeguard to ensure the RAG pipeline
   *  runs for queries that target a specific data source. */
  signalPattern: RegExp;
};

// ── Static provider registry ──────────────────────────────────────────────────
// Add new integrations here. The manifest is generated at runtime from the
// workspace's actually-connected subset of these entries.

const PROVIDER_CONFIG: Record<string, Omit<IntegrationInfo, "provider">> = {
  "slack": {
    name: "Slack",
    description: "team messages across channels",
    sourceTypes: ["slack_message", "slack_reply"],
    signalPattern: /\b(slack|channel|#\w+)\b/i,
  },
  "google-mail": {
    name: "Gmail",
    description: "email communications (senders, recipients, threads)",
    sourceTypes: ["gmail_message"],
    signalPattern: /\b(e-?mails?|emailed|gmail|inbox)\b/i,
  },
  "hubspot": {
    name: "HubSpot",
    description: "CRM data (contacts, companies, deals, tickets, tasks, notes)",
    sourceTypes: ["hubspot_contact", "hubspot_company", "hubspot_deal", "hubspot_ticket", "hubspot_task", "hubspot_note", "hubspot_owner", "hubspot_product", "hubspot_user", "hubspot_kb_article", "hubspot_service_ticket", "hubspot_currency"],
    signalPattern: /\b(hubspot|deals?|pipeline|crm|contacts?|companies|company|tickets?|leads?|products?|owners?|knowledge\s*base|kb\s*article|service\s*tickets?|currenc(?:y|ies))\b/i,
  },
  "google-calendar": {
    name: "Google Calendar",
    description: "calendar events and meetings",
    sourceTypes: ["calendar_event"],
    signalPattern: /\b(calendar|meetings?|events?|schedule[ds]?)\b/i,
  },
  "google-drive": {
    name: "Google Drive",
    description: "documents and files",
    sourceTypes: ["document", "attachment"],
    signalPattern: /\b(google\s+drive|gdrive|drive\s+files?|shared\s+docs?)\b/i,
  },
  "outlook": {
    name: "Outlook",
    description: "Microsoft email, calendar events, and contacts",
    sourceTypes: ["outlook_email", "outlook_event", "outlook_contact"],
    signalPattern: /\b(outlook|microsoft\s+mail|hotmail|live\.com)\b/i,
  },
};

// ── Manifest builder ──────────────────────────────────────────────────────────

/**
 * Build a manifest from the list of provider IDs the workspace has connected.
 * Unknown providers are silently ignored.
 */
export function buildIntegrationManifest(
  connectedProviders: string[]
): IntegrationInfo[] {
  return connectedProviders.flatMap((p) => {
    const config = PROVIDER_CONFIG[p];
    return config ? [{ provider: p, ...config }] : [];
  });
}

// ── Integration signal matching ───────────────────────────────────────────────

/**
 * Returns true when the query text mentions ANY connected integration.
 * Used as a deterministic safeguard so the RAG pipeline always runs for
 * queries that target a specific data source.  Adding a new integration
 * requires ONLY adding an entry to PROVIDER_CONFIG — this function is generic.
 */
export function queryMatchesConnectedIntegration(
  query: string,
  integrations: IntegrationInfo[]
): boolean {
  return integrations.some((i) => i.signalPattern.test(query));
}

/**
 * Matches queries that explicitly ask about ALL connected integrations rather
 * than a single one — e.g. "across all my tools", "everything connected",
 * "all my data sources".  These should bypass the profile-sufficient gate and
 * search every source type with no filter.
 *
 * Only fires when the workspace has ≥ 2 integrations connected (otherwise
 * "all tools" is a single tool and the per-provider signal handles it).
 */
const CROSS_INTEGRATION_RE =
  /\b(?:(?:all|every|each\s+of)\s+(?:my\s+)?(?:connected\s+)?(?:tools?|integrations?|sources?|platforms?|apps?|channels?|data(?:\s+sources?)?|systems?)|across\s+(?:all\s+)?(?:my\s+)?(?:tools?|integrations?|sources?|platforms?|apps?|data|systems?|everything)|everything\s+(?:connected|integrated|i(?:'ve|'m)\s+connected\s+to|hooked\s+up)|all\s+(?:of\s+)?(?:my\s+)?(?:connected|integrated)\s+(?:tools?|apps?|services?|data|systems?|platforms?))\b/i;

export function queryMatchesCrossIntegrationSignal(
  query: string,
  integrations: IntegrationInfo[]
): boolean {
  return integrations.length >= 2 && CROSS_INTEGRATION_RE.test(query);
}

// ── Ambiguity detection ───────────────────────────────────────────────────────

/** Providers that represent person-to-person communication. */
const COMM_PROVIDERS = new Set(["slack", "google-mail", "outlook"]);

/**
 * Patterns that signal a vague communication query that doesn't specify which
 * integration to search.  Only triggers when no integration-specific signal
 * (email / slack) is already present in the query.
 */
const AMBIGUOUS_COMM_RE =
  /\b(messages?\s+(?:i|me)\s+(?:received|got|sent)|sent\s+me|recent\s+(?:communications?|updates?|activity))\b/i;

/**
 * When the query is ambiguous across multiple connected communication integrations
 * (e.g. both Slack and Gmail are connected and the user says "what messages were
 * sent to me?"), returns a clarifying question string.
 * Returns null when no ambiguity is detected.
 */
export function detectAmbiguousQuery(
  query: string,
  integrations: IntegrationInfo[]
): string | null {
  const commIntegrations = integrations.filter((i) =>
    COMM_PROVIDERS.has(i.provider)
  );
  if (commIntegrations.length < 2) return null;
  if (!AMBIGUOUS_COMM_RE.test(query)) return null;
  // If the query specifically mentions one integration, it's not ambiguous
  if (commIntegrations.some((i) => i.signalPattern.test(query))) return null;

  const names = commIntegrations.map((i) => i.name);
  const listStr =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

  const options = commIntegrations
    .map((i) => (i.provider === "slack" ? "Slack messages" : "Gmail emails"))
    .join(", ");

  return `I can see communications in both ${listStr}. Are you looking for ${options}, or both?`;
}

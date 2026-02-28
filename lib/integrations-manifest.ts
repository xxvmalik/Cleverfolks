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
};

// ── Static provider registry ──────────────────────────────────────────────────
// Add new integrations here. The manifest is generated at runtime from the
// workspace's actually-connected subset of these entries.

const PROVIDER_CONFIG: Record<string, Omit<IntegrationInfo, "provider">> = {
  "slack": {
    name: "Slack",
    description: "team messages across channels",
    sourceTypes: ["slack_message", "slack_reply"],
  },
  "google-mail": {
    name: "Gmail",
    description: "email communications (senders, recipients, threads)",
    sourceTypes: ["gmail_message"],
  },
  "hubspot": {
    name: "HubSpot",
    description: "CRM data (deals, contacts, pipeline)",
    sourceTypes: ["deal"],
  },
  "google-calendar": {
    name: "Google Calendar",
    description: "calendar events and meetings",
    sourceTypes: ["calendar_event"],
  },
  "google-drive": {
    name: "Google Drive",
    description: "documents and files",
    sourceTypes: ["document", "attachment"],
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

// ── Ambiguity detection ───────────────────────────────────────────────────────

/** Providers that represent person-to-person communication. */
const COMM_PROVIDERS = new Set(["slack", "google-mail"]);

/**
 * Patterns that signal a vague communication query that doesn't specify which
 * integration to search.  Only triggers when no integration-specific signal
 * (email / slack) is already present in the query.
 */
const AMBIGUOUS_COMM_RE =
  /\b(messages?\s+(?:i|me)\s+(?:received|got|sent)|sent\s+me|recent\s+(?:communications?|updates?|activity))\b/i;

const EMAIL_SIGNAL_RE = /\b(email|gmail|e-mail|inbox)\b/i;
const SLACK_SIGNAL_RE = /\b(slack|channel|#\w+)\b/i;

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
  if (EMAIL_SIGNAL_RE.test(query) || SLACK_SIGNAL_RE.test(query)) return null;

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

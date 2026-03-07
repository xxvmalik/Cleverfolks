import type { IntegrationInfo } from "@/lib/integrations-manifest";
import {
  type WorkspaceRow,
  type OnboardingRow,
  type KnowledgeProfileRow,
  formatKnowledgeProfile,
} from "@/lib/cleverbrain/system-prompt";

// Re-export types for convenience
export type { WorkspaceRow, OnboardingRow, KnowledgeProfileRow };

// ── Integration awareness map (Skyler-flavored) ─────────────────────────────

const ALL_PROVIDERS: Array<{
  provider: string;
  name: string;
  description: string;
  sourceTypes: string[];
}> = [
  {
    provider: "slack",
    name: "Slack",
    description: "team messages, channel conversations, internal discussions",
    sourceTypes: ["slack_message", "slack_reply"],
  },
  {
    provider: "google-mail",
    name: "Gmail",
    description: "email communications, client conversations, vendor correspondence",
    sourceTypes: ["gmail_message"],
  },
  {
    provider: "outlook",
    name: "Outlook",
    description: "email, calendar events, contacts, meetings, schedules",
    sourceTypes: ["outlook_email", "outlook_event", "outlook_contact"],
  },
  {
    provider: "hubspot",
    name: "HubSpot",
    description: "CRM — contacts, companies, deals, tickets, tasks, notes, pipeline data",
    sourceTypes: ["hubspot_contact", "hubspot_company", "hubspot_deal", "hubspot_ticket", "hubspot_task", "hubspot_note", "hubspot_owner", "hubspot_product", "hubspot_user"],
  },
  {
    provider: "google-calendar",
    name: "Google Calendar",
    description: "calendar events, meetings, schedules, attendees",
    sourceTypes: ["calendar_event"],
  },
  {
    provider: "google-drive",
    name: "Google Drive",
    description: "documents, proposals, SOPs, shared files",
    sourceTypes: ["document", "attachment"],
  },
  {
    provider: "cleverbrain",
    name: "CleverBrain Chat History",
    description: "past CleverBrain conversations and decisions",
    sourceTypes: ["cleverbrain_chat"],
  },
];

function buildIntegrationAwarenessMap(
  connectedIntegrations: IntegrationInfo[]
): string {
  const connectedProviders = new Set(connectedIntegrations.map((i) => i.provider));

  const lines: string[] = [];
  for (const p of ALL_PROVIDERS) {
    const isConnected = connectedProviders.has(p.provider);
    const status = isConnected ? "CONNECTED" : "NOT CONNECTED";
    let line = `- ${p.name} [${status}] — ${p.description}`;
    if (isConnected) {
      line += `\n  Source types for tool calls: ${p.sourceTypes.join(", ")}`;
    }
    lines.push(line);
  }

  return `INTEGRATION AWARENESS MAP:
${lines.join("\n")}

When the ideal integration is not connected:
1. Search connected integrations for partial answers
2. Use web search if external knowledge helps
3. Deliver the best answer from available data
4. Recommend connecting the ideal integration — explain what it would unlock for our pipeline`;
}

// ── System prompt builder ─────────────────────────────────────────────────────

export function buildSkylerSystemPrompt(
  workspace: WorkspaceRow | null,
  onboarding: OnboardingRow | null,
  knowledgeProfile: KnowledgeProfileRow | null,
  connectedIntegrations: IntegrationInfo[] = [],
  memories?: Array<{
    scope: string;
    type: string;
    content: string;
    confidence: string;
    times_reinforced: number;
  }>,
  autonomyLevel: "full" | "approval_required" | "read_only" = "approval_required"
): string {
  const settings = workspace?.settings ?? {};
  const orgData = onboarding?.org_data ?? {};
  const skylerData = onboarding?.skyler_data ?? {};

  const companyName =
    (settings.company_name as string | undefined)?.trim() ||
    (orgData.step1?.companyName as string | undefined)?.trim() ||
    workspace?.name?.trim() ||
    "your company";

  const lines: string[] = [];

  const description =
    (settings.description as string | undefined)?.trim() ||
    (skylerData.step8?.companyOverview as string | undefined)?.trim();
  if (description) lines.push(`Description: ${description}`);

  const industry =
    (settings.industry as string | undefined)?.trim() ||
    (orgData.step1?.industry as string | undefined)?.trim();
  if (industry && industry !== "Other") lines.push(`Industry: ${industry}`);

  const rawProducts = (orgData.step4?.products ?? []) as Array<{
    name?: string;
    description?: string;
  }>;
  const productLines = rawProducts
    .filter((p) => p.name)
    .map((p) =>
      p.description?.trim() ? `${p.name}: ${p.description.trim()}` : p.name!
    );
  if (productLines.length > 0)
    lines.push(`Products/services: ${productLines.join(", ")}`);

  const targetAudience =
    (orgData.step2?.targetAudience as string | undefined)?.trim() ||
    (skylerData.step8?.idealCustomerProfile as string | undefined)?.trim();
  if (targetAudience) lines.push(`Target customers: ${targetAudience}`);

  const positioning =
    (orgData.step2?.positioning as string | undefined)?.trim() ||
    (skylerData.step8?.uniqueValueProp as string | undefined)?.trim();
  if (positioning) lines.push(`Positioning: ${positioning}`);

  const companySection =
    lines.length > 0 ? `\nOUR COMPANY:\n${lines.join("\n")}\n` : "";

  // ── Knowledge profile ─────────────────────────────────────────
  let intelligenceSection = "";
  if (
    (knowledgeProfile?.status === "ready" ||
      knowledgeProfile?.status === "pending_review") &&
    knowledgeProfile.profile &&
    Object.keys(knowledgeProfile.profile).length > 0
  ) {
    const formatted = formatKnowledgeProfile(knowledgeProfile.profile);
    if (formatted) {
      intelligenceSection = `\nCOMPANY INTELLIGENCE:\n${formatted}\n`;
    }
  }

  // ── Memory context (shared with CleverBrain) ──────────────────
  let memorySection = "";
  if (memories && memories.length > 0) {
    const corrections = memories.filter((m) => m.type === "correction");
    const preferences = memories.filter((m) => m.type === "preference");
    const terminology = memories.filter((m) => m.type === "terminology");
    const patterns = memories.filter((m) => m.type === "pattern");
    const learnings = memories.filter((m) => m.type === "learning");

    const mandatoryRules: string[] = [];
    if (terminology.length > 0 || corrections.length > 0) {
      for (const m of [...terminology, ...corrections]) {
        mandatoryRules.push(`- ${m.content}`);
      }
    }

    const mandatoryBlock =
      mandatoryRules.length > 0
        ? `## TERMINOLOGY AND CORRECTIONS YOU MUST USE — NON-NEGOTIABLE
The user has explicitly corrected the following. These override ANY terminology in source data, tool results, or your own assumptions.

${mandatoryRules.join("\n")}

Always use the correct term from your VERY FIRST mention.\n\n`
        : "";

    const sections: string[] = [];
    if (preferences.length > 0) {
      sections.push(
        "USER PREFERENCES:\n" +
          preferences.map((m) => `- ${m.content}`).join("\n")
      );
    }
    if (patterns.length > 0) {
      sections.push(
        "KNOWN PATTERNS:\n" +
          patterns.map((m) => `- ${m.content}`).join("\n")
      );
    }
    if (learnings.length > 0) {
      sections.push(
        "AGENT LEARNINGS:\n" +
          learnings.map((m) => `- ${m.content}`).join("\n")
      );
    }

    const contextBlock =
      sections.length > 0
        ? `MEMORY — LEARNED CONTEXT FROM PAST CONVERSATIONS:\n${sections.join("\n\n")}\n`
        : "";

    memorySection = `\n${mandatoryBlock}${contextBlock}`;
  }

  // ── Integration awareness map ─────────────────────────────────────────
  const integrationMap = buildIntegrationAwarenessMap(connectedIntegrations);

  // ── Timezone ──────────────────────────────────────────────────────────
  const workspaceTimezone = (settings.timezone as string | undefined)?.trim() || "UTC";
  const now = new Date();
  let isoDate: string;
  let humanDate: string;
  let humanTime: string;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: workspaceTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    isoDate = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
    humanDate = now.toLocaleDateString("en-US", {
      timeZone: workspaceTimezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    humanTime = now.toLocaleTimeString("en-US", {
      timeZone: workspaceTimezone,
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    isoDate = now.toISOString();
    humanDate = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    humanTime = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  // ── Autonomy description ──────────────────────────────────────────────
  const autonomyDescription = {
    full: "You have FULL AUTONOMY. You can take sales actions directly — send emails, create deals, update CRM records. Act decisively.",
    approval_required: "You operate in APPROVAL REQUIRED mode. Draft everything for the user's review before execution. Present your plan, then wait for approval.",
    read_only: "You operate in READ ONLY mode. Analyze data and make recommendations, but do not suggest taking direct actions. Focus on insights, analysis, and strategic advice.",
  }[autonomyLevel];

  return `You are Skyler, a Sales AI Employee at ${companyName}. You are a dedicated member of the sales team — not a chatbot, not an assistant. You work alongside your teammates to drive revenue, close deals, and grow the business.

You say "our pipeline", "our prospects", "our team". You celebrate wins ("Great news — we just moved TechCorp to negotiation!") and flag risks ("Heads up — the Acme deal has been stuck in qualification for 2 weeks"). You think like a sales professional.

TODAY IS: ${humanDate}, ${humanTime} (${isoDate}). Workspace timezone: ${workspaceTimezone}.

AUTONOMY LEVEL: ${autonomyDescription}
${companySection}${intelligenceSection}${memorySection}
${integrationMap}

## HOW YOU THINK (Read this before every response)

Before responding to ANY message, follow this mental process:

### Step 1: Check your memories
Read through your workspace memories above. Do any of them directly answer or relate to this message? If a memory fully answers the question, respond from memory — no tools needed. Just answer naturally as if you always knew it.

### Step 2: Understand what the user actually wants
- "How's our pipeline" → Fetch ALL deals, summarize by stage.
- "What's happening with [deal]" → Search for that specific deal.
- "Who should I follow up with" → Find stalled deals, overdue close dates, cold prospects.
- "Prep me for my call with [company]" → Pull everything: CRM data, emails, Slack mentions, web research.
- A greeting → Respond warmly as a teammate. Share a quick pipeline highlight if you have data.

### Step 3: Apply everything you know
When you find data from any source, filter it through your memories before responding. Your memories are your learned understanding of this business — they override generic assumptions.

### Step 4: Only then decide on tools
If after steps 1-3 you still need data, pick the right tool:
- Pipeline overview / "all deals" → fetch_recent_messages with source_types=['hubspot_deal'], after=2020-01-01, limit=500
- Specific deal/topic search → search_knowledge_base
- Person-specific → search_by_person
- External research (competitors, prospects) → search_web / browse_website
- Time-based → fetch_recent_messages with date range
- "All contacts" / "all companies" → fetch_recent_messages with appropriate source_types

Never search "just to be thorough." If you know the answer, give it.
When tool results include a "TOTAL RECORDS RETURNED" line, ALWAYS use that exact count.

TOOL USAGE:
- For LISTING ALL records of a type (deals, contacts, companies): use fetch_recent_messages with source_types filter, wide time window, and limit=500
- search_knowledge_base only returns top-K semantic matches — it WILL miss records when the user wants "all"
- For calendar/meeting queries: set source_types=['outlook_event', 'calendar_event']
- You can call multiple tools in one turn if the query needs data from different sources

CRITICAL TIME RULES:
- "next meeting" / "upcoming" → set after=${isoDate} (FUTURE ONLY)
- "last meeting" / "previous" → set before=${isoDate} (PAST ONLY)
- "this week" → Monday to Sunday of current week
- "recently" or "latest" → last 7 days
- "overdue" → close_date before today AND deal not Closed Won/Lost

DATE CALCULATION:
Today's date is ${isoDate}. Use this for ALL time calculations.
- A deal closing March 20 is NOT overdue if today is March 7 — it closes in 13 days.
- A deal that closed Feb 28 IS overdue if today is March 7 — it is 7 days past due.
Always subtract dates correctly.

RESPONSE STYLE:
- LEAD WITH THE ANSWER. Start with the insight, not the search process.
- Speak as a sales teammate. "We've got 5 deals in negotiation worth $180K total" not "I found 5 records with status negotiation."
- Celebrate wins: "Nice — we closed the DataFlow deal for $45K!"
- Flag risks proactively: "The Quantum Analytics deal hasn't moved in 12 days. Want me to look into what's blocking it?"
- Match response length to complexity. Pipeline overview = structured summary. Quick question = quick answer.
- ONE proactive suggestion at the end maximum. Make it actionable.
- When you find stalled deals, cold prospects, or upcoming close dates — ALWAYS flag them. This is your job.

PROACTIVE SALES INTELLIGENCE:
When analyzing deals or pipeline, always look for:
- Deals with close dates in the next 7 days → "Closing soon" alerts
- Deals with close dates past today → "Overdue" warnings
- Deals that haven't changed stage in 14+ days → "Stalled" flags
- High-value deals in early stages → Highlight the opportunity
- Deals with no recent activity (no emails, no Slack mentions) → "Gone cold" warnings

CAPABILITIES:
- Search and analyze data across all connected integrations
- Provide pipeline analysis, deal insights, and sales strategy
- Research prospects and competitors via web search
- Help prepare for calls and meetings
- Draft follow-up messages and outreach (in approval_required mode, draft for review)

LIMITATIONS:
- Cannot send emails or messages directly — read-only access to connected tools
- Data syncs periodically, so the most recent changes may not appear yet
- Cannot access private Slack channels unless the bot is invited`;
}

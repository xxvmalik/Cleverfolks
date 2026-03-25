import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool definitions for the CleverBrain agent.
 * Each tool maps to an existing Supabase RPC or external API.
 * Claude uses these descriptions to decide when to call each tool.
 */

export const CLEVERBRAIN_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Semantic + keyword hybrid search across all synced business data (Slack messages, emails, documents, etc.). " +
      "Use this for specific topic searches, finding discussions about a subject, locating information by keyword, " +
      "or when the user asks about a specific event/issue/project. " +
      "Returns the most relevant messages/documents ranked by relevance. " +
      "Do NOT use this for counting or ranking people — use count_messages_by_person instead. " +
      "NEVER use this tool for calendar/meeting/schedule queries — use fetch_recent_messages with source_types=['outlook_event'] or ['calendar_event'] and set the 'after' parameter to ensure correct time filtering.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The search query — use specific keywords and phrases that would appear in relevant messages.",
        },
        after: {
          type: "string",
          description:
            "ISO 8601 date string. Only return results after this date. Use for time-scoped searches like 'this week' or 'last month'.",
        },
        before: {
          type: "string",
          description:
            "ISO 8601 date string. Only return results before this date.",
        },
        source_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by source type(s). Examples: ['slack_message', 'slack_reply'] for Slack, ['gmail_message'] for email, ['deal'] for HubSpot. Omit to search all sources.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_recent_messages",
    description:
      "Fetch messages chronologically from a time period. Use this for summaries, briefings, catch-ups, " +
      "or when the user asks 'what happened' during a time range. Returns messages sorted by time. " +
      "Best for: 'summarise this week', 'what happened yesterday', 'morning briefing', 'catch me up'. " +
      "Do NOT use this for counting/ranking — use count_messages_by_person instead. " +
      "ALSO use this tool for ALL calendar/meeting/schedule queries — you MUST set source_types to ['outlook_event', 'calendar_event'] for meeting queries. " +
      "For 'next meeting' or 'upcoming': set 'after' to the current date/time ISO string. For 'last meeting' or 'past': set 'before' to the current date/time. " +
      "If no results, retry with a wider window (14 days before and after today). Sort results chronologically to find the nearest event. " +
      "IMPORTANT FOR CALENDAR EVENTS: The time filter on this tool uses sync time, not event time. For calendar events, always check the 'start' field in the event metadata to determine if the event is actually upcoming or past. An event synced yesterday with start time tomorrow is still an UPCOMING event.",
    input_schema: {
      type: "object" as const,
      properties: {
        after: {
          type: "string",
          description:
            "ISO 8601 date string. Start of the time window. Required for meaningful results.",
        },
        before: {
          type: "string",
          description:
            "ISO 8601 date string. End of the time window. Defaults to now if omitted.",
        },
        source_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by source type(s). Omit to fetch from all connected integrations.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of messages to return. Default 150. Use higher (200-300) for multi-source briefings.",
        },
      },
      required: [],
    },
  },
  {
    name: "count_messages_by_person",
    description:
      "SQL-based aggregation that counts messages per person across channels. Use this for ALL counting, ranking, and comparison questions: " +
      "'who sent the most messages', 'top 5 most active people', 'rank everyone by complaints', 'how many messages did each person send'. " +
      "Also returns a sample of recent messages for qualitative context. " +
      "For dedicated channels (channels entirely about a topic like #order-complaints), ALL messages are counted. " +
      "For other channels, only keyword-matched messages are counted.",
    input_schema: {
      type: "object" as const,
      properties: {
        after: {
          type: "string",
          description: "ISO 8601 date string. Start of counting window.",
        },
        before: {
          type: "string",
          description: "ISO 8601 date string. End of counting window.",
        },
        source_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by source type(s). Use ['gmail_message'] for 'who emailed me the most', ['slack_message','slack_reply'] for Slack counts.",
        },
        dedicated_channels: {
          type: "array",
          items: { type: "string" },
          description:
            "Channel names (without #) whose ENTIRE purpose matches the query topic. All messages in these channels are counted. " +
            "Example: for complaints → ['order-complaints', 'payment-complaints']. Empty array if no channel is dedicated to the topic.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description:
            "6-10 keywords for catching topic mentions in non-dedicated channels. " +
            "Example for complaints: ['complaint', 'issue', 'problem', 'failed', 'error', 'refund', 'broken', 'wrong']. " +
            "Empty array to count ALL messages (e.g. 'most active people').",
        },
      },
      required: [],
    },
  },
  {
    name: "search_by_person",
    description:
      "Find messages authored by or mentioning a specific person. Use when the user asks about what a particular person " +
      "said, did, or was mentioned in. Returns messages with match_type indicating whether the person authored the message or was mentioned. " +
      "Use this for: 'what did Sarah say', 'messages from John', 'anything about Mike this week'.",
    input_schema: {
      type: "object" as const,
      properties: {
        person_name: {
          type: "string",
          description:
            "The person's name to search for. Use the exact name from the company profile when available.",
        },
        after: {
          type: "string",
          description: "ISO 8601 date string. Only return results after this date.",
        },
        before: {
          type: "string",
          description: "ISO 8601 date string. Only return results before this date.",
        },
      },
      required: ["person_name"],
    },
  },
  {
    name: "search_web",
    description:
      "Search the public web for external information. Use for industry trends, competitor info, market data, " +
      "general knowledge questions that need current information, or when the user explicitly asks to search the web. " +
      "Do NOT use for searching the user's own business data — use the other tools for that.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The web search query. Be specific — include company names, product names, and relevant context.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of web results to return. Default 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_website",
    description:
      "Fetch and read the full content of a specific web page. Use this when you need to visit a specific URL and read its actual content " +
      "-- for example, checking a competitor's services page, reading a product page, or getting details from a specific webpage. " +
      "This is different from search_web: search_web finds pages via search engines, browse_website reads the actual content of a known URL. " +
      "Use browse_website when: the user gives you a specific URL, you need to check a specific page on a website (like /services, /pricing, /about), " +
      "or search_web returned a relevant URL that needs deeper reading.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description:
            "The full URL to fetch (must include https://). Example: https://the-owlet.com/services",
        },
        query: {
          type: "string",
          description:
            "What you're looking for on this page. Used to extract the most relevant section from large pages. " +
            "Example: 'cheapest Instagram followers price', 'contact email', 'team members'. " +
            "Always provide this so the tool can find the right content on large pages.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "map_website",
    description:
      "Discover all pages on a website by mapping its structure. Returns a list of URLs found on the site. " +
      "Use this BEFORE browse_website when you need to find the right page on a website but don't know the exact URL. " +
      "For example: user says 'check owlet's pricing' -- first map_website('https://the-owlet.com') to find the pricing/services page URL, " +
      "then browse_website that URL to read the actual content. " +
      "Only use this when you need to discover pages. If you already know the URL (user gave it or it's obvious like /services or /pricing), skip mapping and go straight to browse_website.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description:
            "The base URL of the website to map (must include https://). Example: https://the-owlet.com",
        },
      },
      required: ["url"],
    },
  },
  // ── Skyler Pipeline + Agent Visibility Tools ──────────────────────────────
  {
    name: "query_sales_pipeline",
    description:
      "Query Skyler's sales pipeline to see lead cards. Use when the user asks about their pipeline, sales leads, deals, " +
      "prospects, or outreach status. Returns lead cards with stage, health score, contact info, deal value, and last activity. " +
      "Supports filtering by stage, resolution status, search query, and date range. " +
      "Examples: 'how many leads do I have?', 'show me engaged leads', 'what deals are in negotiation?', 'any new leads this week?'",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: {
          type: "string",
          description:
            "Filter by pipeline stage. Options: initial_outreach, follow_up_1, follow_up_2, follow_up_3, replied, negotiation, demo_booked, payment_secured, closed_won, stalled, disqualified. Omit to see all stages.",
        },
        resolution: {
          type: "string",
          description:
            "Filter by resolution. Options: meeting_booked, demo_booked, payment_secured, disqualified, no_response. Use 'null' or omit for unresolved (active) leads.",
        },
        search: {
          type: "string",
          description:
            "Search by contact name, email, or company name. Case-insensitive partial match.",
        },
        after: {
          type: "string",
          description: "ISO 8601 date string. Only return leads created after this date.",
        },
        before: {
          type: "string",
          description: "ISO 8601 date string. Only return leads created before this date.",
        },
        limit: {
          type: "number",
          description: "Maximum leads to return. Default 20, max 100.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_lead_details",
    description:
      "Get full details on a specific lead including activity timeline, email history, decisions made by Skyler, and pending actions. " +
      "Use when the user asks about a specific lead, contact, or deal. Provide either the lead ID or contact email. " +
      "Examples: 'tell me about the Acme deal', 'what's happening with john@example.com?', 'show me details on lead X'",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: {
          type: "string",
          description: "The pipeline record UUID. Use this if you have it from a previous query_sales_pipeline call.",
        },
        contact_email: {
          type: "string",
          description: "The contact's email address. Use this if the user mentions an email or you need to look up by email.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_agent_activity",
    description:
      "See what Skyler (or other AI agents) have been doing. Returns a summary of agent actions grouped by type. " +
      "Use when the user asks: 'what has Skyler done?', 'any agent activity?', 'what's been happening?', 'Skyler's recent actions'. " +
      "Can filter by agent, activity type, and date range.",
    input_schema: {
      type: "object" as const,
      properties: {
        agent_type: {
          type: "string",
          description: "Filter by agent. Options: 'skyler', 'cleverbrain'. Omit for all agents.",
        },
        activity_type: {
          type: "string",
          description:
            "Filter by activity type. Options: email_drafted, email_sent, lead_scored, lead_created, meeting_booked, " +
            "deal_stage_changed, deal_closed_won, deal_closed_lost, escalation_raised, reply_detected, followup_scheduled, " +
            "info_requested, research_completed, note_created, crm_synced, meeting_no_show, reengagement_started. Omit for all types.",
        },
        after: {
          type: "string",
          description: "ISO 8601 date string. Only return activity after this date. Default: last 7 days.",
        },
        before: {
          type: "string",
          description: "ISO 8601 date string. Only return activity before this date.",
        },
        limit: {
          type: "number",
          description: "Maximum activities to return. Default 30, max 100.",
        },
      },
      required: [],
    },
  },
  {
    name: "pipeline_metrics",
    description:
      "Get aggregated sales pipeline metrics: total leads by stage, total pipeline value, conversion rates, average deal size, " +
      "win/loss rates, and activity counts. Use for performance questions: 'how's the pipeline?', 'what's our conversion rate?', " +
      "'how many deals did we close this month?', 'pipeline value?', 'sales performance'. " +
      "Supports time period comparisons.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          description:
            "Predefined period: 'this_week', 'this_month', 'this_quarter', 'last_month', 'last_quarter', 'all_time'. " +
            "Alternatively use after/before for custom ranges. Default: 'all_time'.",
        },
        after: {
          type: "string",
          description: "ISO 8601 date string. Start of custom period. Overrides 'period' if both are set.",
        },
        before: {
          type: "string",
          description: "ISO 8601 date string. End of custom period.",
        },
      },
      required: [],
    },
  },
];

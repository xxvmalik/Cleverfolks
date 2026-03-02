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
      "If no results, retry with a wider window (14 days before and after today). Sort results chronologically to find the nearest event.",
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
];

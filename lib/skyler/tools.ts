/**
 * Skyler's tool definitions.
 * Reuses CleverBrain's tools — same read-only tools for Sub-Sprint 1.
 * Write tools (CRM updates, email sending) will be added in Sub-Sprint 2.
 */

import { CLEVERBRAIN_TOOLS } from "@/lib/cleverbrain/tools";

// For Sub-Sprint 1: Skyler uses the exact same read-only tools as CleverBrain.
// We filter to the 5 tools Skyler needs (excluding count_messages_by_person and map_website
// which are less relevant to sales workflows).
const SKYLER_TOOL_NAMES = new Set([
  "search_knowledge_base",
  "fetch_recent_messages",
  "search_by_person",
  "search_web",
  "browse_website",
]);

export const SKYLER_TOOLS = CLEVERBRAIN_TOOLS.filter((t) =>
  SKYLER_TOOL_NAMES.has(t.name)
);

import { Nango } from "@nangohq/node";

/** userId → resolved real name */
export type SlackUserMap = Record<string, string>;

/**
 * Build a userId→name map from raw Nango SlackUser records.
 * Priority: real_name → profile.display_name → name (Slack handle) → id
 * Bots and deleted accounts are excluded.
 */
export function buildUserMap(records: Record<string, unknown>[]): SlackUserMap {
  const map: SlackUserMap = {};
  for (const raw of records) {
    const id = raw.id as string | undefined;
    if (!id) continue;
    if ((raw.is_bot as boolean | undefined) === true) continue;
    if ((raw.deleted as boolean | undefined) === true) continue;

    const profile = (raw.profile as Record<string, unknown> | undefined) ?? {};
    const realName = (raw.real_name as string | undefined)?.trim();
    const displayName = (profile.display_name as string | undefined)?.trim();
    const handle = raw.name as string | undefined;

    map[id] =
      (realName && realName.length > 0 ? realName : undefined) ??
      (displayName && displayName.length > 0 ? displayName : undefined) ??
      handle ??
      id;
  }
  return map;
}

/**
 * Replace <@UXXXXXXXX> and <@UXXXXXXXX|handle> Slack user mentions with
 * the resolved real name from the map.
 * Falls back to the inline handle, then the raw user ID if not in the map.
 */
export function resolveSlackMentions(text: string, userMap: SlackUserMap): string {
  return text.replace(
    /<@(U[A-Z0-9]+)(?:\|([^>]+))?>/g,
    (_match: string, userId: string, handle?: string) =>
      userMap[userId] ?? handle ?? userId
  );
}

/**
 * Fetch all Slack users from Nango and return a userId→name map.
 * Automatically paginates through all pages.
 */
export async function fetchSlackUserMap(
  nango: Nango,
  connectionId: string
): Promise<SlackUserMap> {
  const allRecords: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = (await nango.listRecords({
      providerConfigKey: "slack",
      connectionId,
      model: "SlackUser",
      cursor,
    })) as { records: Record<string, unknown>[]; next_cursor: string | null };

    allRecords.push(...page.records);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }

  const map = buildUserMap(allRecords);
  console.log(`[slack-resolver] Built user map — ${Object.keys(map).length} real users`);
  return map;
}

/**
 * Recall.ai API client for Skyler.
 *
 * Full wrapper around the Recall AI REST API for meeting bot management.
 * Handles bot creation, status checks, transcript retrieval, cancellation,
 * and listing. Includes 507 retry logic for capacity errors.
 *
 * Auth: Token-based header via RECALL_AI_API_KEY env var.
 * Region: RECALL_AI_BASE_URL env var (defaults to us-east-1).
 */

const RECALL_BASE_URL =
  process.env.RECALL_AI_BASE_URL ?? "https://us-east-1.recall.ai";

/** Platforms supported by Recall.ai */
const SUPPORTED_MEETING_DOMAINS = [
  "zoom.us",
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "gotomeeting.com",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.RECALL_AI_API_KEY;
  if (!key) throw new Error("RECALL_AI_API_KEY not set");
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

/** Sleep helper for retry backoff */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make a Recall API request with automatic retry on 507 (capacity full).
 * Retries up to 3 times with exponential backoff.
 */
async function recallFetch(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 507 && attempt < retries) {
      const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
      console.warn(
        `[recall] 507 capacity full, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
      );
      await sleep(delay);
      continue;
    }

    return response;
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("[recall] Max retries exceeded");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a meeting URL is for a platform Recall.ai supports.
 */
export function isSupportedMeetingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SUPPORTED_MEETING_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

// ── createBot ───────────────────────────────────────────────────────────────

export type CreateBotParams = {
  meetingUrl: string;
  botName?: string;
  /** ISO timestamp — schedule at least 10 mins before meeting start */
  joinAt?: string;
  /** Metadata attached to the bot (workspace_id, lead_id, etc.) */
  metadata?: Record<string, string>;
};

export type CreateBotResult = {
  id: string;
  meetingUrl: string;
};

/**
 * Create a Recall bot and send it to a meeting.
 * Uses prioritize_accuracy transcription mode.
 * Includes 507 retry for capacity errors.
 */
export async function createRecallBot(
  params: CreateBotParams
): Promise<CreateBotResult> {
  const body: Record<string, unknown> = {
    meeting_url: params.meetingUrl,
    bot_name: params.botName ?? "Skyler Notetaker",
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: { mode: "prioritize_accuracy" },
        },
      },
    },
  };

  // Attach metadata for webhook matching
  if (params.metadata) {
    body.metadata = params.metadata;
  }

  // Schedule bot if meeting is in the future (>10 min)
  if (params.joinAt) {
    const joinTime = new Date(params.joinAt).getTime();
    const now = Date.now();
    if (joinTime - now > 10 * 60 * 1000) {
      body.join_at = params.joinAt;
    }
  }

  const response = await recallFetch(`${RECALL_BASE_URL}/api/v1/bot`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`Recall API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log(
    `[recall] Bot created: ${data.id} for meeting ${params.meetingUrl}`
  );

  return {
    id: data.id,
    meetingUrl: params.meetingUrl,
  };
}

// ── getBot ──────────────────────────────────────────────────────────────────

export type RecallParticipant = {
  id: number;
  name: string;
  is_host: boolean;
  platform?: string;
  extra_data?: Record<string, unknown>;
};

export type RecallBotInfo = {
  id: string;
  status: string;
  statusChanges: Array<{ code: string; created_at: string; sub_code?: string | null }>;
  meetingUrl?: string;
  metadata?: Record<string, string>;
  meetingParticipants?: RecallParticipant[];
};

/**
 * Get full bot info including status, metadata, and meeting URL.
 */
export async function getRecallBot(
  botId: string
): Promise<RecallBotInfo | null> {
  try {
    const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${botId}`, {
      method: "GET",
      headers: authHeaders(),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      id: data.id,
      status:
        data.status_changes?.[data.status_changes.length - 1]?.code ??
        "unknown",
      statusChanges: data.status_changes ?? [],
      meetingUrl: data.meeting_url,
      metadata: data.metadata,
      meetingParticipants: data.meeting_participants ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Determine what actually happened in a meeting based on Recall bot data.
 *
 * Scenarios:
 * - "completed": bot recorded successfully (status reached in_call_recording or done with transcript)
 * - "recording_failed": bot joined but recording/transcript failed
 * - "nobody_joined": bot never entered the call (no in_call status)
 * - "lead_no_show": bot joined, host was present, but lead never appeared
 * - "user_no_show": bot joined, lead appeared, but host never did
 *
 * @param botInfo - Full bot info from getRecallBot()
 * @param contactEmail - The lead's email (to identify them in participants)
 * @param hostEmail - The user/host email (to identify them in participants)
 */
export function determineMeetingOutcome(
  botInfo: RecallBotInfo,
  contactEmail?: string,
  hostEmail?: string,
): "completed" | "recording_failed" | "nobody_joined" | "lead_no_show" | "user_no_show" {
  const statuses = botInfo.statusChanges.map((s) => s.code);
  const subCodes = botInfo.statusChanges.map((s) => s.sub_code).filter(Boolean);
  const participants = botInfo.meetingParticipants ?? [];

  // Check if bot timed out in waiting room — nobody started/admitted it
  if (subCodes.includes("timeout_exceeded_waiting_room")) {
    return "nobody_joined";
  }

  // Check if bot ever entered the call
  const wasInCall = statuses.some((s) =>
    ["in_call_not_recording", "in_call_recording"].includes(s)
  );

  // Check for fatal errors
  const hasFatalError = statuses.some((s) =>
    ["fatal", "analysis_failed", "media_expired"].includes(s)
  );

  // If bot recorded successfully and there were participants beyond the bot
  if (statuses.includes("in_call_recording") && participants.length > 0) {
    if (hasFatalError) return "recording_failed";
    return "completed";
  }

  // Bot never entered the call — nobody started the meeting
  if (!wasInCall) {
    return "nobody_joined";
  }

  // Bot was in call but no recording — might be waiting room timeout or similar
  if (wasInCall && !statuses.includes("in_call_recording")) {
    if (participants.length === 0) {
      return "nobody_joined";
    }
  }

  // Bot was in the call — check who showed up based on participants
  if (participants.length === 0) {
    return "nobody_joined";
  }

  // Try to identify lead vs host in participants
  const participantNames = participants.map((p) => p.name?.toLowerCase() ?? "");
  const contactLower = contactEmail?.toLowerCase() ?? "";
  const hostLower = hostEmail?.toLowerCase() ?? "";

  const leadPresent = contactLower
    ? participants.some((p) => {
        const name = p.name?.toLowerCase() ?? "";
        const email = (p.extra_data?.email as string)?.toLowerCase() ?? "";
        return email === contactLower || name.includes(contactLower.split("@")[0]);
      })
    : false;

  const hostPresent = hostLower
    ? participants.some((p) => {
        const name = p.name?.toLowerCase() ?? "";
        const email = (p.extra_data?.email as string)?.toLowerCase() ?? "";
        return p.is_host || email === hostLower || name.includes(hostLower.split("@")[0]);
      })
    : participants.some((p) => p.is_host);

  if (!leadPresent && !hostPresent) return "nobody_joined";
  if (!leadPresent && hostPresent) return "lead_no_show";
  if (leadPresent && !hostPresent) return "user_no_show";

  // Both present but no recording — recording failed
  if (hasFatalError) return "recording_failed";

  return "completed";
}

/** @deprecated Use getRecallBot instead. Kept for backward compatibility. */
export async function getRecallBotStatus(
  botId: string
): Promise<{
  status: string;
  statusChanges: Array<{ code: string; created_at: string; sub_code?: string | null }>;
} | null> {
  return getRecallBot(botId);
}

// ── getBotTranscript ────────────────────────────────────────────────────────

export type TranscriptSegment = {
  speaker: string;
  words: Array<{ text: string; start_time?: number; end_time?: number }>;
};

/**
 * Fetch the raw transcript for a completed bot.
 * Returns the raw segment array for structured processing,
 * or null if transcript is not available.
 */
export async function getRecallTranscriptRaw(
  botId: string
): Promise<TranscriptSegment[] | null> {
  try {
    const response = await fetch(
      `${RECALL_BASE_URL}/api/v1/bot/${botId}/transcript`,
      {
        method: "GET",
        headers: authHeaders(),
      }
    );

    if (!response.ok) {
      console.warn(
        `[recall] Transcript fetch failed for bot ${botId}: ${response.status}`
      );
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data)) return null;

    return data as TranscriptSegment[];
  } catch (err) {
    console.error(
      `[recall] Transcript fetch error for bot ${botId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Fetch the transcript as a formatted text string.
 * Each line: "Speaker: text"
 */
export async function getRecallTranscript(
  botId: string
): Promise<string | null> {
  const segments = await getRecallTranscriptRaw(botId);
  if (!segments || segments.length === 0) return null;

  const lines = segments.map((segment) => {
    const speaker = segment.speaker ?? "Unknown";
    const text = (segment.words ?? []).map((w) => w.text).join(" ");
    return `${speaker}: ${text}`;
  });

  return lines.join("\n");
}

// ── deleteBot ───────────────────────────────────────────────────────────────

/**
 * Cancel/delete a scheduled or active bot.
 */
export async function deleteRecallBot(botId: string): Promise<boolean> {
  try {
    const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${botId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    if (response.ok || response.status === 204) {
      console.log(`[recall] Bot ${botId} deleted`);
      return true;
    }

    console.warn(
      `[recall] Delete bot ${botId} failed: ${response.status}`
    );
    return false;
  } catch (err) {
    console.error(
      `[recall] Delete bot error:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

// ── listBots ────────────────────────────────────────────────────────────────

export type ListBotsParams = {
  /** Filter by meeting URL */
  meetingUrl?: string;
  /** Max results (default 50) */
  limit?: number;
};

/**
 * List bots with optional filters.
 */
export async function listRecallBots(
  params?: ListBotsParams
): Promise<RecallBotInfo[]> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.meetingUrl)
      searchParams.set("meeting_url", params.meetingUrl);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    const url = `${RECALL_BASE_URL}/api/v1/bot${qs ? `?${qs}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const results = data.results ?? data;

    if (!Array.isArray(results)) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.map((bot: any) => ({
      id: bot.id,
      status:
        bot.status_changes?.[bot.status_changes.length - 1]?.code ?? "unknown",
      statusChanges: bot.status_changes ?? [],
      meetingUrl: bot.meeting_url,
      metadata: bot.metadata,
    }));
  } catch {
    return [];
  }
}

// ── Calendar V2 API ─────────────────────────────────────────────────────────

export type CreateCalendarParams = {
  /** OAuth platform: "google_calendar" or "microsoft_outlook" */
  platform: "google_calendar" | "microsoft_outlook";
  /** OAuth refresh token from the user's calendar provider */
  oauthRefreshToken: string;
  /** Client ID for the OAuth app */
  oauthClientId: string;
  /** Client secret for the OAuth app */
  oauthClientSecret: string;
  /** Webhook URL for calendar sync events */
  webhookUrl?: string;
};

export type RecallCalendar = {
  id: string;
  platform: string;
  platform_email?: string;
  status?: string;
};

/**
 * Connect a calendar to Recall via Calendar V2 API.
 * Returns the Recall calendar ID for future operations.
 */
export async function createRecallCalendar(
  params: CreateCalendarParams
): Promise<RecallCalendar> {
  const body: Record<string, unknown> = {
    platform: params.platform,
    oauth_refresh_token: params.oauthRefreshToken,
    oauth_client_id: params.oauthClientId,
    oauth_client_secret: params.oauthClientSecret,
  };

  if (params.webhookUrl) {
    body.webhook_url = params.webhookUrl;
  }

  const response = await recallFetch(
    `${RECALL_BASE_URL}/api/v2/calendars`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`Recall Calendar API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log(`[recall] Calendar created: ${data.id} (${params.platform})`);

  return {
    id: data.id,
    platform: data.platform,
    platform_email: data.platform_email,
    status: data.status,
  };
}

/**
 * Delete/disconnect a calendar from Recall.
 */
export async function deleteRecallCalendar(calendarId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${RECALL_BASE_URL}/api/v2/calendars/${calendarId}`,
      { method: "DELETE", headers: authHeaders() }
    );
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

export type CalendarEvent = {
  id: string;
  title?: string;
  start_time: string;
  end_time: string;
  meeting_url?: string;
  is_deleted?: boolean;
  attendees?: Array<{
    email: string;
    name?: string;
    is_organizer?: boolean;
  }>;
};

/**
 * List calendar events from a connected Recall calendar.
 */
export async function listCalendarEvents(
  calendarId: string,
  params?: { startTime?: string; endTime?: string }
): Promise<CalendarEvent[]> {
  try {
    const searchParams = new URLSearchParams();
    searchParams.set("calendar_id", calendarId);
    if (params?.startTime) searchParams.set("start_time__gte", params.startTime);
    if (params?.endTime) searchParams.set("start_time__lte", params.endTime);

    const response = await fetch(
      `${RECALL_BASE_URL}/api/v2/calendar-events?${searchParams.toString()}`,
      { method: "GET", headers: authHeaders() }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.results ?? data) as CalendarEvent[];
  } catch {
    return [];
  }
}

/**
 * Schedule a Recall bot for a specific calendar event.
 * Uses Recall's dedup_key to prevent duplicate bots.
 */
export async function scheduleBotForCalendarEvent(params: {
  calendarEventId: string;
  botName?: string;
  /** Dedup key to prevent duplicate bots (e.g. "{start_time}-{meeting_url}") */
  dedupKey?: string;
  metadata?: Record<string, string>;
}): Promise<CreateBotResult> {
  const body: Record<string, unknown> = {
    calendar_event_id: params.calendarEventId,
    bot_config: {
      bot_name: params.botName ?? "Skyler Notetaker",
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: { mode: "prioritize_accuracy" },
          },
        },
      },
    },
  };

  if (params.dedupKey) body.dedup_key = params.dedupKey;
  if (params.metadata) body.bot_config = { ...body.bot_config as object, metadata: params.metadata };

  const response = await recallFetch(
    `${RECALL_BASE_URL}/api/v2/calendar-events/${params.calendarEventId}/bot`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`Recall Schedule Bot API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return { id: data.id ?? data.bot_id, meetingUrl: "" };
}

// ── Webhook secret verification ─────────────────────────────────────────────

/**
 * Verify the webhook secret token from a request URL.
 * The webhook URL should include ?token={RECALL_WEBHOOK_SECRET}.
 */
export function verifyWebhookSecret(tokenFromUrl: string | null): boolean {
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[recall] RECALL_WEBHOOK_SECRET not set — skipping verification");
    return true; // Allow in dev when secret isn't configured
  }
  return tokenFromUrl === secret;
}

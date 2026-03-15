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

export type RecallBotInfo = {
  id: string;
  status: string;
  statusChanges: Array<{ code: string; created_at: string }>;
  meetingUrl?: string;
  metadata?: Record<string, string>;
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
    };
  } catch {
    return null;
  }
}

/** @deprecated Use getRecallBot instead. Kept for backward compatibility. */
export async function getRecallBotStatus(
  botId: string
): Promise<{
  status: string;
  statusChanges: Array<{ code: string; created_at: string }>;
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

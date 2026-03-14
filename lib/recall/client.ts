/**
 * Recall.ai API client for Skyler.
 * Sends a bot to join meetings, retrieves transcripts.
 */

const RECALL_BASE_URL = process.env.RECALL_AI_BASE_URL ?? "https://us-east-1.recall.ai";

/** Platforms supported by Recall.ai */
const SUPPORTED_MEETING_DOMAINS = [
  "zoom.us",
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "gotomeeting.com",
];

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

type CreateBotParams = {
  meetingUrl: string;
  botName?: string;
  joinAt?: string; // ISO timestamp — if >10min future, bot is "scheduled"
};

type CreateBotResult = {
  id: string;
  meetingUrl: string;
};

/**
 * Create a Recall bot and send it to a meeting.
 * Webhook events (bot.done, bot.fatal, transcript) are delivered via
 * the account-level webhook configured in the Recall dashboard.
 */
export async function createRecallBot(params: CreateBotParams): Promise<CreateBotResult> {
  const apiKey = process.env.RECALL_AI_API_KEY;
  if (!apiKey) throw new Error("RECALL_AI_API_KEY not set");

  const body: Record<string, unknown> = {
    meeting_url: params.meetingUrl,
    bot_name: params.botName ?? "Skyler Notetaker",
    recording_config: {
      transcript: {
        provider: {
          meeting_captions: {},
        },
      },
    },
  };

  // If meeting is in the future, schedule the bot
  if (params.joinAt) {
    const joinTime = new Date(params.joinAt).getTime();
    const now = Date.now();
    if (joinTime - now > 10 * 60 * 1000) {
      body.join_at = params.joinAt;
    }
  }

  const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`Recall API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log(`[recall] Bot created: ${data.id} for meeting ${params.meetingUrl}`);

  return {
    id: data.id,
    meetingUrl: params.meetingUrl,
  };
}

/**
 * Get the status of a Recall bot.
 */
export async function getRecallBotStatus(botId: string): Promise<{ status: string; statusChanges: Array<{ code: string; created_at: string }> } | null> {
  const apiKey = process.env.RECALL_AI_API_KEY;
  if (!apiKey) throw new Error("RECALL_AI_API_KEY not set");

  try {
    const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${botId}`, {
      method: "GET",
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      status: data.status_changes?.[data.status_changes.length - 1]?.code ?? "unknown",
      statusChanges: data.status_changes ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the transcript for a completed bot.
 */
export async function getRecallTranscript(botId: string): Promise<string | null> {
  const apiKey = process.env.RECALL_AI_API_KEY;
  if (!apiKey) throw new Error("RECALL_AI_API_KEY not set");

  try {
    const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${botId}/transcript`, {
      method: "GET",
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.warn(`[recall] Transcript fetch failed for bot ${botId}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Transcript is an array of segments with speaker + words
    if (Array.isArray(data)) {
      const lines = data.map((segment: { speaker: string; words: Array<{ text: string }> }) => {
        const speaker = segment.speaker ?? "Unknown";
        const text = (segment.words ?? []).map((w) => w.text).join(" ");
        return `${speaker}: ${text}`;
      });
      return lines.join("\n");
    }

    return typeof data === "string" ? data : JSON.stringify(data);
  } catch (err) {
    console.error(`[recall] Transcript fetch error for bot ${botId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Diagnostic script: Query Recall API for Doubra's bot to determine
 * what actually happened in her meeting.
 *
 * Bot ID: ad46f12d-d46d-47f6-90fd-8c17b835f004
 *
 * Run: npx tsx scripts/diagnose-doubra-meeting.ts
 */

const RECALL_BASE_URL = process.env.RECALL_AI_BASE_URL ?? "https://us-east-1.recall.ai";
const RECALL_API_KEY = process.env.RECALL_AI_API_KEY;

if (!RECALL_API_KEY) {
  console.error("RECALL_AI_API_KEY not set. Add it to .env.local and run with:");
  console.error("  npx dotenv -e .env.local -- npx tsx scripts/diagnose-doubra-meeting.ts");
  process.exit(1);
}

const BOT_ID = "ad46f12d-d46d-47f6-90fd-8c17b835f004";

async function main() {
  console.log(`\n🔍 Diagnosing Doubra's meeting bot: ${BOT_ID}\n`);

  const response = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${BOT_ID}`, {
    method: "GET",
    headers: {
      Authorization: `Token ${RECALL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(`Recall API error: ${response.status} ${response.statusText}`);
    const body = await response.text().catch(() => "");
    console.error(body);
    process.exit(1);
  }

  const bot = await response.json();

  // Status changes
  console.log("━━━ STATUS CHANGES ━━━");
  const statusChanges = bot.status_changes ?? [];
  for (const sc of statusChanges) {
    const time = new Date(sc.created_at).toLocaleString();
    console.log(`  ${time}  →  ${sc.code}${sc.message ? ` (${sc.message})` : ""}`);
  }
  const finalStatus = statusChanges[statusChanges.length - 1]?.code ?? "unknown";
  console.log(`\n  Final status: ${finalStatus}`);

  // Participants
  console.log("\n━━━ MEETING PARTICIPANTS ━━━");
  const participants = bot.meeting_participants ?? [];
  if (participants.length === 0) {
    console.log("  No participants detected");
  } else {
    for (const p of participants) {
      console.log(`  ${p.name}${p.is_host ? " (HOST)" : ""}${p.platform ? ` [${p.platform}]` : ""}`);
      if (p.extra_data) console.log(`    extra: ${JSON.stringify(p.extra_data)}`);
    }
  }

  // Metadata
  console.log("\n━━━ BOT METADATA ━━━");
  console.log(`  Meeting URL: ${bot.meeting_url ?? "none"}`);
  console.log(`  Bot name: ${bot.bot_name ?? "none"}`);
  console.log(`  Metadata: ${JSON.stringify(bot.metadata ?? {})}`);

  // Transcript check
  console.log("\n━━━ TRANSCRIPT CHECK ━━━");
  const transcriptRes = await fetch(`${RECALL_BASE_URL}/api/v1/bot/${BOT_ID}/transcript`, {
    method: "GET",
    headers: {
      Authorization: `Token ${RECALL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (transcriptRes.ok) {
    const transcript = await transcriptRes.json();
    if (Array.isArray(transcript) && transcript.length > 0) {
      console.log(`  Transcript segments: ${transcript.length}`);
      console.log(`  First speaker: ${transcript[0]?.speaker ?? "unknown"}`);
    } else {
      console.log("  No transcript data");
    }
  } else {
    console.log(`  Transcript fetch failed: ${transcriptRes.status}`);
  }

  // Determine outcome
  console.log("\n━━━ OUTCOME DETERMINATION ━━━");
  const statuses = statusChanges.map((s: { code: string }) => s.code);
  const wasInCall = statuses.some((s: string) =>
    ["in_call_not_recording", "in_call_recording", "done"].includes(s)
  );
  const hadRecording = statuses.includes("in_call_recording");
  const hasFatal = statuses.some((s: string) =>
    ["fatal", "analysis_failed", "media_expired"].includes(s)
  );

  if (!wasInCall) {
    console.log("  ❌ NOBODY JOINED — The bot never entered the call.");
    console.log("     The meeting was never started by either party.");
  } else if (hadRecording && participants.length > 0 && !hasFatal) {
    console.log("  ✅ COMPLETED — Meeting took place with recording.");
  } else if (hadRecording && hasFatal) {
    console.log("  ⚠️  RECORDING FAILED — Bot recorded but processing failed.");
  } else if (wasInCall && participants.length === 0) {
    console.log("  ❌ NOBODY JOINED — Bot entered call but no participants detected.");
  } else if (wasInCall && participants.length > 0) {
    // Check who was there
    const hostPresent = participants.some((p: { is_host: boolean }) => p.is_host);
    const nonHostCount = participants.filter((p: { is_host: boolean }) => !p.is_host).length;
    if (hostPresent && nonHostCount === 0) {
      console.log("  ❌ LEAD NO-SHOW — Host was present but lead never joined.");
    } else if (!hostPresent && nonHostCount > 0) {
      console.log("  ⚠️  USER NO-SHOW — Lead joined but the host wasn't there.");
    } else {
      console.log("  ❓ UNCLEAR — Both parties may have been present briefly.");
    }
  } else {
    console.log("  ❓ UNCLEAR — Cannot determine from available data.");
  }

  // Raw data dump for inspection
  console.log("\n━━━ RAW BOT OBJECT (key fields) ━━━");
  console.log(JSON.stringify({
    id: bot.id,
    status_changes: bot.status_changes,
    meeting_participants: bot.meeting_participants,
    meeting_url: bot.meeting_url,
    metadata: bot.metadata,
    join_at: bot.join_at,
    real_time_transcription: bot.real_time_transcription,
  }, null, 2));
}

main().catch(console.error);

/**
 * Process meeting transcripts from Recall.ai.
 *
 * When a meeting ends and the transcript is ready:
 * 1. Fetch full transcript (combine real-time chunks + Recall API)
 * 2. AI classifies the meeting outcome (won / lost / needs_follow_up)
 * 3. Extracts action items — separates Skyler tasks from user tasks
 * 4. Extracts follow-up timing mentioned in the conversation
 * 5. Updates pipeline record accordingly
 * 6. Creates action notes with deadlines for user tasks
 * 7. Schedules follow-up cadence for Skyler tasks
 */

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallTranscript } from "@/lib/recall/client";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { syncResolutionToHubSpot } from "@/lib/hubspot/crm-sync";
import { parseAIJson } from "@/lib/utils/parse-ai-json";

type MeetingClassification = {
  outcome: "won" | "lost" | "needs_follow_up";
  reasoning: string;
  skyler_tasks: Array<{
    task: string;
    follow_up_date?: string; // ISO date or relative like "next Wednesday"
    context: string; // what was discussed that relates to this task
  }>;
  user_tasks: Array<{
    task: string;
    deadline?: string; // ISO date or relative
    context: string;
  }>;
  key_discussion_points: string[];
  follow_up_date?: string; // when to follow up (ISO or relative)
};

export const processMeetingTranscript = inngest.createFunction(
  {
    id: "process-meeting-transcript",
    retries: 2,
  },
  { event: "skyler/meeting.transcript.ready" },
  async ({ event, step }) => {
    const { pipelineId, workspaceId, botId, contactEmail, contactName, companyName } = event.data as {
      pipelineId: string;
      workspaceId: string;
      botId: string;
      contactEmail: string;
      contactName: string;
      companyName: string;
    };

    // Step 1: Get the full transcript
    const transcript = await step.run("fetch-transcript", async () => {
      const db = createAdminSupabaseClient();

      // First check if we have real-time transcript chunks stored
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("meeting_transcript")
        .eq("id", pipelineId)
        .single();

      const realtimeTranscript = (pipeline?.meeting_transcript as string) ?? "";

      // Also try to get the full transcript from Recall API (may be more complete)
      const recallTranscript = await getRecallTranscript(botId);

      // Use whichever is longer (more complete)
      const finalTranscript = recallTranscript && recallTranscript.length > realtimeTranscript.length
        ? recallTranscript
        : realtimeTranscript;

      if (!finalTranscript || finalTranscript.trim().length < 50) {
        console.warn(`[meeting-transcript] Transcript too short or empty for pipeline ${pipelineId}`);
        return null;
      }

      // Store the best transcript
      if (finalTranscript !== realtimeTranscript) {
        await db
          .from("skyler_sales_pipeline")
          .update({ meeting_transcript: finalTranscript, updated_at: new Date().toISOString() })
          .eq("id", pipelineId);
      }

      console.log(`[meeting-transcript] Transcript ready: ${finalTranscript.length} chars for pipeline ${pipelineId}`);
      return finalTranscript;
    });

    if (!transcript) {
      return { status: "skipped", reason: "no_transcript" };
    }

    // Step 2: AI classification of meeting outcome
    const classification = await step.run("classify-meeting-outcome", async () => {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are analyzing a sales meeting transcript between our team and a prospect.

PROSPECT: ${contactName} from ${companyName ?? "unknown company"} (${contactEmail})

Analyze the meeting and respond with ONLY valid JSON (no markdown fences):

{
  "outcome": "won|lost|needs_follow_up",
  "reasoning": "1-2 sentence explanation of why this outcome",
  "skyler_tasks": [
    {
      "task": "what Skyler (AI sales assistant) should do next",
      "follow_up_date": "ISO date or relative like 'next Wednesday' — when to do this",
      "context": "what was discussed that makes this task relevant"
    }
  ],
  "user_tasks": [
    {
      "task": "what the human user needs to do (things AI cannot do — calls, contracts, demos, visits)",
      "deadline": "ISO date or relative — when this should be done",
      "context": "what was discussed that makes this task relevant"
    }
  ],
  "key_discussion_points": ["point 1", "point 2", "point 3"],
  "follow_up_date": "when to follow up based on what was said in the meeting"
}

OUTCOME RULES:
- "won": prospect explicitly agreed to buy, sign, pay, or move forward with a deal
- "lost": prospect explicitly said no, going with competitor, not interested, not now with no timeline
- "needs_follow_up": anything else — needs to think, check with team, wants proposal, asked for more info, set a future date

TASK RULES:
- skyler_tasks: things an AI email assistant can do (send follow-up email, share info, schedule next touchpoint)
- user_tasks: things ONLY a human can do (make a phone call, send a contract, give a live demo, visit office, negotiate pricing in person)
- Look for SPECIFIC commitments: "call me tomorrow", "send the contract by Friday", "let's meet again next week"
- Convert relative dates to specific dates based on today being ${new Date().toISOString().split("T")[0]}

MEETING TRANSCRIPT:
${transcript.slice(0, 15000)}`,
        }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      try {
        const result = parseAIJson<MeetingClassification>(text);
        console.log(`[meeting-transcript] Classification: ${result.outcome} — ${result.reasoning}`);
        return result;
      } catch {
        console.warn(`[meeting-transcript] Failed to parse classification, defaulting to needs_follow_up`);
        return {
          outcome: "needs_follow_up" as const,
          reasoning: "Classification parse failed",
          skyler_tasks: [],
          user_tasks: [],
          key_discussion_points: [],
        };
      }
    });

    // Step 3: Update pipeline based on outcome
    await step.run("update-pipeline", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();

      // Resolve follow-up date to an actual ISO timestamp
      const followUpDate = resolveDate(classification.follow_up_date);

      // Build action notes from user_tasks
      const actionNotes = classification.user_tasks.map((task) => ({
        task: task.task,
        deadline: resolveDate(task.deadline),
        context: task.context,
        created_at: now,
        notified: false,
        completed: false,
        source: "meeting_transcript",
      }));

      if (classification.outcome === "won") {
        // Deal won — set resolution
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "closed_won",
            resolution_notes: `Won in meeting: ${classification.reasoning}`,
            resolved_at: now,
            stage: "closed_won",
            meeting_outcome: classification,
            action_notes: actionNotes,
            awaiting_reply: false,
            next_followup_at: null,
            updated_at: now,
          })
          .eq("id", pipelineId);

        await dispatchNotification(db, {
          workspaceId,
          eventType: "deal_closed_won",
          pipelineId,
          title: `Deal won: ${contactName}`,
          body: classification.reasoning,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });

        await syncResolutionToHubSpot({
          workspaceId,
          contactEmail,
          contactName,
          companyName: companyName ?? undefined,
          resolution: "closed_won",
        });

        console.log(`[meeting-transcript] Deal WON for ${contactName}`);

      } else if (classification.outcome === "lost") {
        // Deal lost — set resolution
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "closed_lost",
            resolution_notes: `Lost in meeting: ${classification.reasoning}`,
            resolved_at: now,
            stage: "closed_lost",
            meeting_outcome: classification,
            action_notes: actionNotes,
            awaiting_reply: false,
            next_followup_at: null,
            updated_at: now,
          })
          .eq("id", pipelineId);

        await dispatchNotification(db, {
          workspaceId,
          eventType: "deal_closed_lost",
          pipelineId,
          title: `Deal lost: ${contactName}`,
          body: classification.reasoning,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });

        await syncResolutionToHubSpot({
          workspaceId,
          contactEmail,
          contactName,
          companyName: companyName ?? undefined,
          resolution: "closed_lost",
        });

        console.log(`[meeting-transcript] Deal LOST for ${contactName}`);

      } else {
        // Needs follow-up — keep pipeline active, schedule follow-up with meeting context
        await db
          .from("skyler_sales_pipeline")
          .update({
            stage: "follow_up_meeting",
            meeting_outcome: classification,
            action_notes: actionNotes,
            awaiting_reply: false,
            next_followup_at: followUpDate,
            updated_at: now,
          })
          .eq("id", pipelineId);

        // Notify about follow-up needed
        const followUpMsg = followUpDate
          ? `Follow-up scheduled for ${new Date(followUpDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
          : "Follow-up needed — no specific date mentioned";

        await dispatchNotification(db, {
          workspaceId,
          eventType: "meeting_booked",
          pipelineId,
          title: `Meeting follow-up: ${contactName}`,
          body: `${classification.reasoning}. ${followUpMsg}`,
          metadata: {
            contactEmail,
            companyName,
            keyPoints: classification.key_discussion_points,
            followUpDate,
            source: "meeting_transcript",
          },
        });

        console.log(`[meeting-transcript] Follow-up needed for ${contactName}, next: ${followUpDate ?? "no date"}`);
      }

      // Notify about user tasks (action notes)
      for (const task of actionNotes) {
        if (task.deadline) {
          console.log(`[meeting-transcript] Action note: "${task.task}" due ${task.deadline}`);
        }
      }
    });

    return {
      status: "processed",
      outcome: classification.outcome,
      skyler_tasks: classification.skyler_tasks.length,
      user_tasks: classification.user_tasks.length,
    };
  }
);

// ── Action Note Deadline Checker ────────────────────────────────────────────

/**
 * Cron: check for action notes whose deadlines have passed or are today.
 * Notifies the user via their configured notification channels.
 */
export const actionNoteDeadlineChecker = inngest.createFunction(
  {
    id: "action-note-deadline-checker",
    retries: 1,
  },
  { cron: "0 8 * * *" }, // Every day at 8 AM
  async ({ step }) => {
    const notes = await step.run("find-due-notes", async () => {
      const db = createAdminSupabaseClient();
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      // Find pipeline records with action notes that have deadlines due today or past
      const { data: records } = await db
        .from("skyler_sales_pipeline")
        .select("id, workspace_id, contact_name, contact_email, company_name, action_notes")
        .not("action_notes", "eq", "[]")
        .is("resolution", null);

      if (!records) return [];

      const dueNotes: Array<{
        pipelineId: string;
        workspaceId: string;
        contactName: string;
        contactEmail: string;
        companyName: string;
        task: string;
        deadline: string;
        context: string;
        noteIndex: number;
      }> = [];

      for (const rec of records) {
        const notes = (rec.action_notes ?? []) as Array<{
          task: string;
          deadline?: string;
          context: string;
          notified: boolean;
          completed: boolean;
        }>;

        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          if (note.completed || note.notified || !note.deadline) continue;

          const deadlineDate = note.deadline.split("T")[0];
          if (deadlineDate <= today) {
            dueNotes.push({
              pipelineId: rec.id,
              workspaceId: rec.workspace_id,
              contactName: rec.contact_name,
              contactEmail: rec.contact_email,
              companyName: rec.company_name,
              task: note.task,
              deadline: note.deadline,
              context: note.context,
              noteIndex: i,
            });
          }
        }
      }

      console.log(`[action-notes] Found ${dueNotes.length} due action notes`);
      return dueNotes;
    });

    if (notes.length === 0) return { notified: 0 };

    // Notify for each due note
    let notified = 0;
    for (const note of notes) {
      await step.run(`notify-${note.pipelineId}-${note.noteIndex}`, async () => {
        const db = createAdminSupabaseClient();

        await dispatchNotification(db, {
          workspaceId: note.workspaceId,
          eventType: "action_note_due",
          pipelineId: note.pipelineId,
          title: `Action due: ${note.task}`,
          body: `For ${note.contactName} (${note.companyName ?? ""}). Context: ${note.context}`,
          metadata: {
            contactEmail: note.contactEmail,
            task: note.task,
            deadline: note.deadline,
          },
        });

        // Mark the note as notified
        const { data: pipeline } = await db
          .from("skyler_sales_pipeline")
          .select("action_notes")
          .eq("id", note.pipelineId)
          .single();

        if (pipeline) {
          const actionNotes = (pipeline.action_notes ?? []) as Array<Record<string, unknown>>;
          if (actionNotes[note.noteIndex]) {
            actionNotes[note.noteIndex].notified = true;
          }
          await db
            .from("skyler_sales_pipeline")
            .update({ action_notes: actionNotes, updated_at: new Date().toISOString() })
            .eq("id", note.pipelineId);
        }

        notified++;
      });
    }

    console.log(`[action-notes] Notified ${notified} due action notes`);
    return { notified };
  }
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve relative date strings to ISO timestamps. */
function resolveDate(dateStr?: string): string | null {
  if (!dateStr) return null;

  // Already an ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.includes("T") ? dateStr : `${dateStr}T09:00:00.000Z`;
  }

  const now = new Date();
  const lower = dateStr.toLowerCase().trim();

  // "tomorrow"
  if (lower === "tomorrow") {
    const d = new Date(now.getTime() + 86400000);
    return d.toISOString();
  }

  // "next week" / "in X days/weeks"
  const inDaysMatch = lower.match(/in (\d+) day/);
  if (inDaysMatch) {
    const d = new Date(now.getTime() + parseInt(inDaysMatch[1]) * 86400000);
    return d.toISOString();
  }

  const inWeeksMatch = lower.match(/in (\d+) week/);
  if (inWeeksMatch) {
    const d = new Date(now.getTime() + parseInt(inWeeksMatch[1]) * 7 * 86400000);
    return d.toISOString();
  }

  if (lower === "next week") {
    const d = new Date(now.getTime() + 7 * 86400000);
    return d.toISOString();
  }

  // Day names: "next Monday", "Wednesday", etc.
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      const currentDay = now.getDay();
      let daysUntil = i - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      if (lower.includes("next") && daysUntil < 7) daysUntil += 7;
      const d = new Date(now.getTime() + daysUntil * 86400000);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }

  // "end of month", "end of week"
  if (lower.includes("end of week")) {
    const daysUntilFri = (5 - now.getDay() + 7) % 7 || 7;
    const d = new Date(now.getTime() + daysUntilFri * 86400000);
    return d.toISOString();
  }

  // Can't parse — return null
  console.warn(`[meeting-transcript] Could not resolve date: "${dateStr}"`);
  return null;
}

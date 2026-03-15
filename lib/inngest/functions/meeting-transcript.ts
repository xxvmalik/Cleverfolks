/**
 * Process meeting transcripts from Recall.ai — Three-Tier Pipeline.
 *
 * When a meeting ends and the transcript is ready:
 * Step 1: Store raw transcript in meeting_transcripts table
 * Step 2: Extract intelligence (GPT-4o-mini / fast tier)
 *         → action items, objections, buying signals, stakeholders, pain points
 * Step 3: Generate meeting summary (GPT-4o-mini / fast tier)
 *         → executive summary, key takeaways, engagement level, outcome
 * Step 4: Generate follow-up strategy (Claude Sonnet / complex tier)
 *         → SkylerDecision through the guardrail engine
 *
 * Also includes the action note deadline checker cron.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getRecallTranscript, getRecallTranscriptRaw } from "@/lib/recall/client";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { syncResolutionToHubSpot } from "@/lib/hubspot/crm-sync";
import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import { reasonAboutEvent } from "@/lib/skyler/reasoning/skyler-reasoning";
import { checkGuardrails } from "@/lib/skyler/reasoning/guardrail-engine";
import { executeDecision, type ExecutionContext } from "@/lib/skyler/actions/execute-decision";
import { assembleReasoningContext } from "@/lib/skyler/reasoning/context-assembler";
import { chunkAndEmbedTranscript } from "@/lib/skyler/meetings/transcript-chunker";

// ── Types ───────────────────────────────────────────────────────────────────

type MeetingIntelligence = {
  action_items: Array<{ text: string; assigned_to: string; deadline_mentioned?: string }>;
  objections: Array<{ text: string; speaker: string; topic: string }>;
  buying_signals: Array<{ text: string; speaker: string; signal_type: string }>;
  competitor_mentions: Array<{ competitor_name: string; context: string; speaker: string }>;
  commitments: Array<{ text: string; who_committed: string; what_committed: string }>;
  key_questions: Array<{ question: string; speaker: string; was_answered: boolean }>;
  stakeholders_identified: Array<{ name: string; role: string; influence_level: string }>;
  pain_points: Array<{ text: string; speaker: string; severity: string }>;
  next_steps_discussed: Array<{ step: string; owner: string; timeline: string }>;
};

type MeetingSummary = {
  outcome: "won" | "lost" | "needs_follow_up" | "proposal";
  executive_summary: string;
  key_takeaways: string[];
  engagement_level: string;
  emotional_state: string;
  reasoning: string;
  follow_up_date?: string;
  skyler_tasks: Array<{ task: string; follow_up_date?: string; context: string }>;
  user_tasks: Array<{ task: string; deadline?: string; context: string }>;
};

// ── Main Transcript Processing Pipeline ─────────────────────────────────────

export const processMeetingTranscript = inngest.createFunction(
  {
    id: "process-meeting-transcript",
    retries: 2,
  },
  { event: "skyler/meeting.transcript.ready" },
  async ({ event, step }) => {
    const { pipelineId, workspaceId, botId, contactEmail, contactName, companyName } =
      event.data as {
        pipelineId: string;
        workspaceId: string;
        botId: string;
        contactEmail: string;
        contactName: string;
        companyName: string;
      };

    // Step 1: Store raw transcript
    const transcriptId = await step.run("store-raw-transcript", async () => {
      const db = createAdminSupabaseClient();

      // Get transcript from pipeline record or Recall API
      const { data: pipeline } = await db
        .from("skyler_sales_pipeline")
        .select("meeting_transcript")
        .eq("id", pipelineId)
        .single();

      const realtimeTranscript = (pipeline?.meeting_transcript as string) ?? "";
      const rawSegments = await getRecallTranscriptRaw(botId);
      const recallText = rawSegments
        ? rawSegments.map((s) => `${s.speaker ?? "Unknown"}: ${(s.words ?? []).map((w) => w.text).join(" ")}`).join("\n")
        : "";

      const finalTranscript = recallText.length > realtimeTranscript.length ? recallText : realtimeTranscript;

      if (!finalTranscript || finalTranscript.trim().length < 50) {
        console.warn(`[meeting-transcript] Transcript too short for pipeline ${pipelineId}`);
        return null;
      }

      // Update pipeline record with best transcript
      if (finalTranscript !== realtimeTranscript) {
        await db
          .from("skyler_sales_pipeline")
          .update({ meeting_transcript: finalTranscript, updated_at: new Date().toISOString() })
          .eq("id", pipelineId);
      }

      // Check if meeting_transcripts record already exists (webhook may have created it)
      const { data: existing } = await db
        .from("meeting_transcripts")
        .select("id")
        .eq("bot_id", botId)
        .maybeSingle();

      if (existing) {
        // Update processing status
        await db
          .from("meeting_transcripts")
          .update({
            raw_transcript: rawSegments ?? finalTranscript,
            processing_status: "extracting",
          })
          .eq("id", existing.id);
        return existing.id as string;
      }

      // Create new record
      const { data: inserted } = await db
        .from("meeting_transcripts")
        .insert({
          bot_id: botId,
          workspace_id: workspaceId,
          lead_id: pipelineId,
          raw_transcript: rawSegments ?? finalTranscript,
          meeting_date: new Date().toISOString(),
          processing_status: "extracting",
        })
        .select("id")
        .single();

      console.log(`[meeting-transcript] Stored transcript: ${finalTranscript.length} chars`);
      return inserted?.id as string;
    });

    if (!transcriptId) {
      return { status: "skipped", reason: "no_transcript" };
    }

    // Get the transcript text for LLM processing
    const transcriptText = await step.run("get-transcript-text", async () => {
      const db = createAdminSupabaseClient();
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("meeting_transcript")
        .eq("id", pipelineId)
        .single();
      return (data?.meeting_transcript as string) ?? "";
    });

    // Step 2: Extract intelligence (GPT-4o-mini / fast tier)
    const intelligence = await step.run("extract-intelligence", async () => {
      const db = createAdminSupabaseClient();
      await db
        .from("meeting_transcripts")
        .update({ processing_status: "extracting" })
        .eq("id", transcriptId);

      const result = await routedLLMCall({
        task: "extract_meeting_actions",
        tier: "fast",
        systemPrompt: `You extract structured intelligence from sales meeting transcripts. Respond with ONLY valid JSON, no markdown fences.`,
        userContent: `Extract intelligence from this sales meeting transcript between our team and ${contactName} from ${companyName} (${contactEmail}).

Return JSON with these arrays (each can be empty):
{
  "action_items": [{ "text": "...", "assigned_to": "speaker name", "deadline_mentioned": "date or null" }],
  "objections": [{ "text": "the objection", "speaker": "who said it", "topic": "pricing/timing/etc" }],
  "buying_signals": [{ "text": "what they said", "speaker": "who", "signal_type": "interest/urgency/budget_confirmed" }],
  "competitor_mentions": [{ "competitor_name": "...", "context": "what was said", "speaker": "who" }],
  "commitments": [{ "text": "the commitment", "who_committed": "who", "what_committed": "to do what" }],
  "key_questions": [{ "question": "...", "speaker": "who asked", "was_answered": true/false }],
  "stakeholders_identified": [{ "name": "...", "role": "...", "influence_level": "decision_maker/influencer/user" }],
  "pain_points": [{ "text": "the pain point", "speaker": "who mentioned it", "severity": "high/medium/low" }],
  "next_steps_discussed": [{ "step": "what to do", "owner": "who does it", "timeline": "when" }]
}

TRANSCRIPT:
${transcriptText.slice(0, 15000)}`,
        maxTokens: 2000,
        temperature: 0,
      });

      try {
        const parsed = parseAIJson<MeetingIntelligence>(result.text);
        await db
          .from("meeting_transcripts")
          .update({ intelligence: parsed })
          .eq("id", transcriptId);
        console.log(`[meeting-transcript] Intelligence extracted: ${parsed.action_items.length} action items, ${parsed.objections.length} objections, ${parsed.buying_signals.length} signals`);
        return parsed;
      } catch {
        console.warn("[meeting-transcript] Intelligence extraction parse failed");
        return null;
      }
    });

    // Step 3: Generate meeting summary (GPT-4o-mini / fast tier)
    const summary = await step.run("generate-summary", async () => {
      const db = createAdminSupabaseClient();
      await db
        .from("meeting_transcripts")
        .update({ processing_status: "summarising" })
        .eq("id", transcriptId);

      const intelligenceContext = intelligence
        ? `\nEXTRACTED INTELLIGENCE:\n${JSON.stringify(intelligence, null, 2).slice(0, 3000)}`
        : "";

      const result = await routedLLMCall({
        task: "summarise_meeting",
        tier: "fast",
        systemPrompt: `You summarise sales meetings. Today is ${new Date().toISOString().split("T")[0]}. Respond with ONLY valid JSON, no markdown fences.`,
        userContent: `Summarise this sales meeting with ${contactName} from ${companyName}.
${intelligenceContext}

Return JSON:
{
  "outcome": "won|lost|proposal|needs_follow_up",
  "executive_summary": "3-5 sentence summary of the meeting",
  "key_takeaways": ["takeaway 1", "takeaway 2"],
  "engagement_level": "high/medium/low — how engaged was the prospect",
  "emotional_state": "enthusiastic/interested/neutral/hesitant/negative",
  "reasoning": "1-2 sentences explaining the outcome classification",
  "follow_up_date": "ISO date or relative like 'next Wednesday' — when to follow up",
  "skyler_tasks": [{ "task": "what AI should do", "follow_up_date": "when", "context": "why" }],
  "user_tasks": [{ "task": "what human should do", "deadline": "when", "context": "why" }]
}

OUTCOME RULES:
- "won": prospect explicitly agreed AND payment/contract is already done — deal is fully closed
- "proposal": prospect agreed to buy/pay/move forward BUT a commercial step remains (invoice, proposal, contract, payment pending). This is a verbal yes — they committed but haven't paid yet
- "lost": prospect explicitly said no, going with competitor, not interested
- "needs_follow_up": anything else — more discussion needed, no clear commitment

TRANSCRIPT:
${transcriptText.slice(0, 12000)}`,
        maxTokens: 1500,
        temperature: 0,
      });

      try {
        const parsed = parseAIJson<MeetingSummary>(result.text);
        await db
          .from("meeting_transcripts")
          .update({ summary: parsed.executive_summary })
          .eq("id", transcriptId);
        console.log(`[meeting-transcript] Summary: ${parsed.outcome} — ${parsed.executive_summary.slice(0, 100)}`);
        return parsed;
      } catch {
        console.warn("[meeting-transcript] Summary parse failed, defaulting to needs_follow_up");
        return {
          outcome: "needs_follow_up" as const,
          executive_summary: "Summary generation failed",
          key_takeaways: [],
          engagement_level: "unknown",
          emotional_state: "unknown",
          reasoning: "Summary parse failed",
          skyler_tasks: [],
          user_tasks: [],
        };
      }
    });

    // Step 4: Update pipeline based on outcome (same as before)
    await step.run("update-pipeline", async () => {
      const db = createAdminSupabaseClient();
      const now = new Date().toISOString();

      const followUpDate = resolveDate(summary.follow_up_date);
      const actionNotes = summary.user_tasks.map((task) => ({
        task: task.task,
        deadline: resolveDate(task.deadline),
        context: task.context,
        created_at: now,
        notified: false,
        completed: false,
        source: "meeting_transcript",
      }));

      // Build meeting_outcome with intelligence
      const meetingOutcome = {
        outcome: summary.outcome,
        reasoning: summary.reasoning,
        executive_summary: summary.executive_summary,
        key_takeaways: summary.key_takeaways,
        engagement_level: summary.engagement_level,
        emotional_state: summary.emotional_state,
        skyler_tasks: summary.skyler_tasks,
        user_tasks: summary.user_tasks,
        key_discussion_points: summary.key_takeaways,
      };

      if (summary.outcome === "won") {
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "closed_won",
            resolution_notes: `Won in meeting: ${summary.reasoning}`,
            resolved_at: now,
            stage: "closed_won",
            meeting_outcome: meetingOutcome,
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
          body: summary.reasoning,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });

        await syncResolutionToHubSpot({
          workspaceId,
          contactEmail,
          contactName,
          companyName: companyName ?? undefined,
          resolution: "closed_won",
        });
      } else if (summary.outcome === "proposal") {
        // Prospect committed but a commercial step remains (invoice, contract, payment)
        await db
          .from("skyler_sales_pipeline")
          .update({
            stage: "proposal",
            meeting_outcome: meetingOutcome,
            action_notes: actionNotes,
            awaiting_reply: false,
            next_followup_at: followUpDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            updated_at: now,
          })
          .eq("id", pipelineId);

        await dispatchNotification(db, {
          workspaceId,
          eventType: "meeting_booked",
          pipelineId,
          title: `Proposal stage: ${contactName}`,
          body: `${contactName} committed to move forward. Next step: ${summary.reasoning}`,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });

      } else if (summary.outcome === "lost") {
        await db
          .from("skyler_sales_pipeline")
          .update({
            resolution: "closed_lost",
            resolution_notes: `Lost in meeting: ${summary.reasoning}`,
            resolved_at: now,
            stage: "closed_lost",
            meeting_outcome: meetingOutcome,
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
          body: summary.reasoning,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });

        await syncResolutionToHubSpot({
          workspaceId,
          contactEmail,
          contactName,
          companyName: companyName ?? undefined,
          resolution: "closed_lost",
        });
      } else {
        await db
          .from("skyler_sales_pipeline")
          .update({
            stage: "follow_up_meeting",
            meeting_outcome: meetingOutcome,
            action_notes: actionNotes,
            awaiting_reply: false,
            next_followup_at: followUpDate,
            updated_at: now,
          })
          .eq("id", pipelineId);

        const followUpMsg = followUpDate
          ? `Follow-up scheduled for ${new Date(followUpDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
          : "Follow-up needed — no specific date mentioned";

        await dispatchNotification(db, {
          workspaceId,
          eventType: "meeting_booked",
          pipelineId,
          title: `Meeting follow-up: ${contactName}`,
          body: `${summary.reasoning}. ${followUpMsg}`,
          metadata: { contactEmail, companyName, source: "meeting_transcript" },
        });
      }
    });

    // Step 5: Generate follow-up strategy via reasoning engine (Claude Sonnet / complex tier)
    // For needs_follow_up and proposal — won/lost don't need a follow-up email
    if (summary.outcome === "needs_follow_up" || summary.outcome === "proposal") {
      await step.run("generate-followup-strategy", async () => {
        const db = createAdminSupabaseClient();
        await db
          .from("meeting_transcripts")
          .update({ processing_status: "strategising" })
          .eq("id", transcriptId);

        try {
          // Use the reasoning engine — same path as all other decisions
          const reasoningResult = await reasonAboutEvent(
            {
              type: "meeting.transcript.ready",
              data: {
                contactEmail,
                contactName,
                companyName,
                meetingSummary: summary.executive_summary,
                keyTakeaways: summary.key_takeaways,
                actionItems: intelligence?.action_items ?? [],
                objections: intelligence?.objections ?? [],
                commitments: intelligence?.commitments ?? [],
              },
            },
            workspaceId,
            pipelineId
          );

          // Run through guardrail engine (same as every other decision)
          const ctx = await assembleReasoningContext(
            { type: "meeting.transcript.ready", data: {} },
            workspaceId,
            pipelineId
          );

          const guardrailResult = checkGuardrails(
            reasoningResult.decision,
            ctx.workflowSettings,
            {
              emails_sent: ctx.pipeline.emails_sent,
              deal_value: ctx.pipeline.deal_value,
              is_vip: ctx.pipeline.is_vip,
              is_c_suite: ctx.pipeline.is_c_suite,
            }
          );

          // Execute the decision
          const { data: pipeline } = await db
            .from("skyler_sales_pipeline")
            .select("*")
            .eq("id", pipelineId)
            .single();

          if (pipeline) {
            const execCtx: ExecutionContext = {
              db,
              workspaceId,
              pipeline: pipeline as unknown as ExecutionContext["pipeline"],
              decision: reasoningResult.decision,
              guardrail: guardrailResult,
              eventType: "meeting.transcript.ready",
            };
            await executeDecision(execCtx);
          }

          console.log(
            `[meeting-transcript] Follow-up strategy: ${reasoningResult.decision.action_type} (${guardrailResult.outcome})`
          );
        } catch (err) {
          console.error(
            "[meeting-transcript] Follow-up strategy failed:",
            err instanceof Error ? err.message : err
          );
        }
      });
    }

    // Chunk transcript and generate embeddings for semantic search
    await step.run("chunk-and-embed", async () => {
      const db = createAdminSupabaseClient();
      const { data: record } = await db
        .from("meeting_transcripts")
        .select("raw_transcript")
        .eq("id", transcriptId)
        .maybeSingle();

      const rawTranscript = record?.raw_transcript;
      if (!rawTranscript || !Array.isArray(rawTranscript)) {
        console.warn(`[meeting-transcript] No raw segments for chunking (transcript ${transcriptId})`);
        return 0;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const segments = rawTranscript as any[];
      const chunkCount = await chunkAndEmbedTranscript({
        transcriptId,
        leadId: pipelineId,
        workspaceId,
        segments,
      });

      console.log(`[meeting-transcript] Created ${chunkCount} searchable chunks`);
      return chunkCount;
    });

    // Mark transcript as complete
    await step.run("mark-complete", async () => {
      const db = createAdminSupabaseClient();
      await db
        .from("meeting_transcripts")
        .update({ processing_status: "complete" })
        .eq("id", transcriptId);
    });

    return {
      status: "processed",
      transcriptId,
      outcome: summary.outcome,
      intelligence: intelligence
        ? {
            action_items: intelligence.action_items.length,
            objections: intelligence.objections.length,
            buying_signals: intelligence.buying_signals.length,
            stakeholders: intelligence.stakeholders_identified.length,
          }
        : null,
    };
  }
);

// ── Action Note Deadline Checker ────────────────────────────────────────────

export const actionNoteDeadlineChecker = inngest.createFunction(
  {
    id: "action-note-deadline-checker",
    retries: 1,
  },
  { cron: "0 8 * * *" },
  async ({ step }) => {
    const notes = await step.run("find-due-notes", async () => {
      const db = createAdminSupabaseClient();
      const today = new Date().toISOString().split("T")[0];

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

function resolveDate(dateStr?: string): string | null {
  if (!dateStr) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.includes("T") ? dateStr : `${dateStr}T09:00:00.000Z`;
  }

  const now = new Date();
  const lower = dateStr.toLowerCase().trim();

  if (lower === "tomorrow") {
    return new Date(now.getTime() + 86400000).toISOString();
  }

  const inDaysMatch = lower.match(/in (\d+) day/);
  if (inDaysMatch) {
    return new Date(now.getTime() + parseInt(inDaysMatch[1]) * 86400000).toISOString();
  }

  const inWeeksMatch = lower.match(/in (\d+) week/);
  if (inWeeksMatch) {
    return new Date(now.getTime() + parseInt(inWeeksMatch[1]) * 7 * 86400000).toISOString();
  }

  if (lower === "next week") {
    return new Date(now.getTime() + 7 * 86400000).toISOString();
  }

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

  if (lower.includes("end of week")) {
    const daysUntilFri = (5 - now.getDay() + 7) % 7 || 7;
    return new Date(now.getTime() + daysUntilFri * 86400000).toISOString();
  }

  console.warn(`[meeting-transcript] Could not resolve date: "${dateStr}"`);
  return null;
}

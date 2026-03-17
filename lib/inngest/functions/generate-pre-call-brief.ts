/**
 * Pre-Call Brief Generation — Stage 13, Part G
 *
 * Triggered ~30 minutes before a meeting. Assembles all context about
 * the lead and generates a structured briefing document.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { dispatchNotification } from "@/lib/skyler/notifications";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  type SkylerWorkflowSettings,
} from "@/app/api/skyler/workflow-settings/route";

export const generatePreCallBrief = inngest.createFunction(
  { id: "skyler-generate-pre-call-brief", retries: 2 },
  { event: "skyler/meeting.pre-call-brief" },
  async ({ event, step }) => {
    const { workspaceId, calendarEventId, pipelineId } = event.data as {
      workspaceId: string;
      calendarEventId: string;
      pipelineId?: string;
    };

    // Step 1: Load all context in parallel
    const context = await step.run("load-context", async () => {
      const db = createAdminSupabaseClient();

      const [calEventResult, pipelineResult, memoriesResult, settingsResult] =
        await Promise.all([
          db
            .from("calendar_events")
            .select("*")
            .eq("id", calendarEventId)
            .single(),
          pipelineId
            ? db
                .from("skyler_sales_pipeline")
                .select("*")
                .eq("id", pipelineId)
                .single()
            : Promise.resolve({ data: null }),
          pipelineId
            ? db
                .from("agent_memories")
                .select("fact_key, fact_value")
                .or(
                  `scope_type.eq.workspace,and(scope_type.eq.lead,scope_id.eq.${pipelineId})`
                )
                .eq("workspace_id", workspaceId)
                .eq("is_current", true)
            : Promise.resolve({ data: [] }),
          db
            .from("workspaces")
            .select("settings, name")
            .eq("id", workspaceId)
            .single(),
        ]);

      const calEvent = calEventResult.data;
      const pipeline = pipelineResult.data;
      const memories = memoriesResult.data ?? [];
      const wsSettings = (settingsResult.data?.settings ?? {}) as Record<string, unknown>;

      return { calEvent, pipeline, memories, wsSettings, companyName: settingsResult.data?.name };
    });

    if (!context.calEvent) {
      return { status: "skipped", reason: "calendar_event_not_found" };
    }

    // Check if brief already sent
    if (context.calEvent.pre_call_brief_sent) {
      return { status: "skipped", reason: "brief_already_sent" };
    }

    // Step 2: Classify meeting type
    const meetingType = await step.run("classify-meeting", async () => {
      const title = (context.calEvent.title ?? "").toLowerCase();
      const attendees = (context.calEvent.attendees as Array<{ email: string }>) ?? [];
      const duration =
        (new Date(context.calEvent.end_time).getTime() -
          new Date(context.calEvent.start_time).getTime()) /
        60000;

      // Rule-based first
      if (title.includes("demo")) return "demo";
      if (title.includes("intro") || title.includes("introduct")) return "intro";
      if (title.includes("deep dive") || title.includes("technical")) return "deep_dive";
      if (title.includes("negotiat") || title.includes("pricing") || title.includes("closing")) return "negotiation";
      if (title.includes("check-in") || title.includes("check in") || title.includes("sync")) return "check_in";
      if (duration <= 15) return "intro";
      if (duration >= 60) return "deep_dive";
      if (attendees.length >= 4) return "deep_dive";

      return "general";
    });

    // Step 3: Generate brief via Claude Sonnet
    const brief = await step.run("generate-brief", async () => {
      const pipeline = context.pipeline;
      const calEvent = context.calEvent;
      const memories = context.memories;
      const attendees = (calEvent.attendees as Array<{ email: string; name?: string }>) ?? [];
      const formAnswers = calEvent.form_answers as Array<{ question: string; answer: string }> | null;
      const thread = (pipeline?.conversation_thread as Array<{ role: string; content: string; subject?: string; timestamp: string }>) ?? [];

      const prompt = `Generate a pre-call brief for an upcoming ${meetingType} meeting.

## Meeting Details
- Title: ${calEvent.title ?? "Meeting"}
- Time: ${new Date(calEvent.start_time).toLocaleString()}
- Duration: ${Math.round((new Date(calEvent.end_time).getTime() - new Date(calEvent.start_time).getTime()) / 60000)} minutes
- Meeting URL: ${calEvent.meeting_url ?? "None"}
- Attendees: ${attendees.map((a) => `${a.name ?? ""} <${a.email}>`).join(", ")}

## Lead Context
${
  pipeline
    ? `- Name: ${pipeline.contact_name}
- Email: ${pipeline.contact_email}
- Company: ${pipeline.company_name}
- Pipeline Stage: ${pipeline.stage}
- Lead Score: ${pipeline.lead_score ?? "N/A"}
- Deal Value: ${pipeline.deal_value ? "$" + pipeline.deal_value.toLocaleString() : "N/A"}
- Emails Sent: ${pipeline.emails_sent}, Replied: ${pipeline.emails_replied}
- In Pipeline Since: ${pipeline.created_at}`
    : "(No pipeline record linked)"
}

## Conversation History (last 5 messages)
${
  thread.length > 0
    ? thread
        .slice(-5)
        .map((m) => `[${m.role}] ${m.subject ? `"${m.subject}" ` : ""}${m.content.slice(0, 300)}`)
        .join("\n\n")
    : "(No conversation history)"
}

## Known Facts
${memories.length > 0 ? memories.map((m) => `- ${m.fact_key}: ${JSON.stringify(m.fact_value)}`).join("\n") : "(None)"}

${formAnswers?.length ? `## Pre-Meeting Form Answers\n${formAnswers.map((q) => `- ${q.question}: ${q.answer}`).join("\n")}` : ""}

Generate a brief with EXACTLY these 5 sections:
1. WHO: Lead name, company, role, how they found us, previous interactions
2. CONTEXT: Pipeline stage, deal value, last activity, outstanding items
3. THEIR WORLD: Company info, challenges mentioned in conversations
4. ATTENDEES: Name, role for each attendee. Flag new/unknown attendees.
5. TALKING POINTS: 3-5 specific things to bring up based on meeting type and context.

Keep it concise. Each section should be 2-4 bullet points max.`;

      const result = await routedLLMCall({
        task: "pre_call_brief",
        tier: "complex",
        systemPrompt: "You are Skyler, an AI sales assistant. Generate concise, actionable pre-call briefs.",
        userContent: prompt,
        maxTokens: 1500,
      });

      return result.text;
    });

    // Step 4: Deliver and store
    await step.run("deliver-brief", async () => {
      const db = createAdminSupabaseClient();
      const settings = context.wsSettings;
      const workflow = (settings.skyler_workflow ?? DEFAULT_WORKFLOW_SETTINGS) as SkylerWorkflowSettings;

      // Mark brief as sent
      await db
        .from("calendar_events")
        .update({
          pre_call_brief_sent: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", calendarEventId);

      // Send notification
      const leadName = context.pipeline?.contact_name ?? "Unknown";
      await dispatchNotification(db, {
        workspaceId,
        eventType: "pre_call_brief",
        pipelineId: pipelineId ?? undefined,
        title: `Pre-call brief: ${context.calEvent.title ?? "Meeting"} with ${leadName}`,
        body: brief,
        metadata: { calendarEventId, meetingType },
      });

      // Log to CRM
      await inngest.send({
        name: "skyler/crm.log-activity",
        data: {
          workspace_id: workspaceId,
          lead_id: pipelineId,
          activity_type: "meeting_booked",
          action: "create_note",
          payload: {
            title: `Pre-Call Brief: ${context.calEvent.title} - ${new Date(context.calEvent.start_time).toLocaleDateString()}`,
            body: brief,
          },
        },
      });
    });

    return { status: "sent", meetingType, calendarEventId, pipelineId };
  }
);

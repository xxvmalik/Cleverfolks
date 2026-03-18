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
import { resolveLeadFromAttendees } from "@/lib/skyler/calendar/calendar-service";
import { getMemories, formatMemoriesForPrompt } from "@/lib/skyler/memory/agent-memory-store";
import { researchCompany, type CompanyResearch } from "@/lib/skyler/company-research";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  type SkylerWorkflowSettings,
} from "@/app/api/skyler/workflow-settings/route";

export const generatePreCallBrief = inngest.createFunction(
  { id: "skyler-generate-pre-call-brief", retries: 2 },
  { event: "skyler/meeting.pre-call-brief" },
  async ({ event, step }) => {
    const { workspaceId, calendarEventId, pipelineId: explicitPipelineId } = event.data as {
      workspaceId: string;
      calendarEventId: string;
      pipelineId?: string;
    };

    // Step 1: Load all context — resolve lead from attendees if pipelineId not provided
    const context = await step.run("load-context", async () => {
      const db = createAdminSupabaseClient();

      // Always load the calendar event first
      const calEventResult = await db
        .from("calendar_events")
        .select("*")
        .eq("id", calendarEventId)
        .single();

      const calEvent = calEventResult.data;

      // Resolve pipelineId: explicit > calendar_events.lead_id > attendee email match
      let pipelineId = explicitPipelineId ?? (calEvent?.lead_id as string | null) ?? null;

      if (!pipelineId && calEvent) {
        const attendees = (calEvent.attendees as Array<{ email: string }>) ?? [];
        const emails = attendees.map((a) => a.email).filter(Boolean);
        pipelineId = await resolveLeadFromAttendees(workspaceId, emails);

        // Backfill lead_id on the calendar event for future lookups
        if (pipelineId) {
          await db
            .from("calendar_events")
            .update({ lead_id: pipelineId, updated_at: new Date().toISOString() })
            .eq("id", calendarEventId);
        }
      }

      // Load pipeline record with company_research
      let pipeline: Record<string, unknown> | null = null;
      if (pipelineId) {
        const { data } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", pipelineId)
          .single();
        pipeline = data;
      }

      // Load memories using the correct function (queries lead_id, not scope_type)
      const memories = await getMemories(db, workspaceId, pipelineId ?? undefined);

      // Load workspace settings
      const { data: wsData } = await db
        .from("workspaces")
        .select("settings, name")
        .eq("id", workspaceId)
        .single();

      const wsSettings = (wsData?.settings ?? {}) as Record<string, unknown>;

      return {
        calEvent,
        pipeline,
        pipelineId,
        memories,
        wsSettings,
        companyName: wsData?.name,
      };
    });

    if (!context.calEvent) {
      return { status: "skipped", reason: "calendar_event_not_found" };
    }

    // Check if brief already sent
    if (context.calEvent.pre_call_brief_sent) {
      return { status: "skipped", reason: "brief_already_sent" };
    }

    // Step 2: Research company if no existing research
    const companyResearch = await step.run("ensure-company-research", async () => {
      const pipeline = context.pipeline;
      const existingResearch = pipeline?.company_research as CompanyResearch | null;

      // If we already have recent research, use it
      if (existingResearch?.summary) {
        return existingResearch;
      }

      // No research yet — trigger it now
      const companyName = (pipeline?.company_name as string) ?? "";
      const contactName = (pipeline?.contact_name as string) ?? "";
      const contactEmail = (pipeline?.contact_email as string) ?? "";

      // Extract company name from attendee if no pipeline
      const fallbackCompany = companyName ||
        ((context.calEvent.attendees as Array<{ email: string }>)?.[0]?.email?.split("@")[1]?.split(".")[0] ?? "");

      if (!fallbackCompany) return null;

      const db = createAdminSupabaseClient();
      try {
        const research = await researchCompany({
          companyName: fallbackCompany,
          contactName,
          contactEmail,
          workspaceId,
          pipelineId: context.pipelineId ?? undefined,
          db,
        });
        return research;
      } catch (err) {
        console.error("[pre-call-brief] Company research failed:", err);
        return null;
      }
    });

    // Step 3: Classify meeting type
    const meetingType = await step.run("classify-meeting", async () => {
      const title = (context.calEvent.title ?? "").toLowerCase();
      const attendees = (context.calEvent.attendees as Array<{ email: string }>) ?? [];
      const duration =
        (new Date(context.calEvent.end_time).getTime() -
          new Date(context.calEvent.start_time).getTime()) /
        60000;

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

    // Step 4: Generate brief via Claude Sonnet
    const brief = await step.run("generate-brief", async () => {
      const pipeline = context.pipeline;
      const calEvent = context.calEvent;
      const memories = context.memories;
      const attendees = (calEvent.attendees as Array<{ email: string; name?: string }>) ?? [];
      const formAnswers = calEvent.form_answers as Array<{ question: string; answer: string }> | null;
      const thread = (pipeline?.conversation_thread as Array<{ role: string; content: string; subject?: string; timestamp: string }>) ?? [];

      // Format memories using the proper formatter
      const memoriesText = memories.length > 0
        ? formatMemoriesForPrompt(memories)
        : "(None)";

      // Format company research
      let companyResearchText = "(No company research available)";
      if (companyResearch) {
        const cr = companyResearch;
        companyResearchText = [
          cr.summary && `Summary: ${cr.summary}`,
          cr.industry && `Industry: ${cr.industry}`,
          cr.estimated_size && `Size: ${cr.estimated_size}`,
          cr.trigger_event && `Trigger Event: ${cr.trigger_event}`,
          cr.pain_points?.length && `Pain Points: ${cr.pain_points.join("; ")}`,
          cr.talking_points?.length && `Talking Points: ${cr.talking_points.join("; ")}`,
          cr.service_alignment_points?.length && `Service Alignment: ${cr.service_alignment_points.join("; ")}`,
          cr.recent_news?.length && `Recent News: ${cr.recent_news.join("; ")}`,
          cr.website_insights && `Website Insights: ${cr.website_insights}`,
          cr.confidence && `Research Confidence: ${cr.confidence}`,
        ].filter(Boolean).join("\n");
      }

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
- Deal Value: ${pipeline.deal_value ? "$" + Number(pipeline.deal_value).toLocaleString() : "N/A"}
- Emails Sent: ${pipeline.emails_sent}, Replied: ${pipeline.emails_replied}
- In Pipeline Since: ${pipeline.created_at}`
    : "(No pipeline record linked)"
}

## Company Research
${companyResearchText}

## Conversation History (last 5 messages)
${
  thread.length > 0
    ? thread
        .slice(-5)
        .map((m) => `[${m.role}] ${m.subject ? `"${m.subject}" ` : ""}${m.content.slice(0, 300)}`)
        .join("\n\n")
    : "(No conversation history)"
}

## Known Facts (Agent Memories)
${memoriesText}

${formAnswers?.length ? `## Pre-Meeting Form Answers\n${formAnswers.map((q) => `- ${q.question}: ${q.answer}`).join("\n")}` : ""}

Generate a brief with EXACTLY these 5 sections:
1. WHO: Lead name, company, role, how they found us, previous interactions
2. CONTEXT: Pipeline stage, deal value, last activity, outstanding items
3. THEIR WORLD: Company info, challenges, industry insights from research
4. ATTENDEES: Name, role for each attendee. Flag new/unknown attendees.
5. TALKING POINTS: 3-5 specific things to bring up based on meeting type, company research, and conversation history.

Keep it concise. Each section should be 2-4 bullet points max. Use the company research and conversation history to make talking points specific and actionable — never generic.`;

      const result = await routedLLMCall({
        task: "pre_call_brief",
        tier: "complex",
        systemPrompt: "You are Skyler, an AI sales assistant. Generate concise, actionable pre-call briefs. Never say 'Unknown' when you have data — use what you know.",
        userContent: prompt,
        maxTokens: 1500,
      });

      return result.text;
    });

    // Step 5: Deliver and store
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
        pipelineId: context.pipelineId ?? undefined,
        title: `Pre-call brief: ${context.calEvent.title ?? "Meeting"} with ${leadName}`,
        body: brief,
        metadata: { calendarEventId, meetingType },
      });

      // Log to CRM
      await inngest.send({
        name: "skyler/crm.log-activity",
        data: {
          workspace_id: workspaceId,
          lead_id: context.pipelineId,
          activity_type: "meeting_booked",
          action: "create_note",
          payload: {
            title: `Pre-Call Brief: ${context.calEvent.title} - ${new Date(context.calEvent.start_time).toLocaleDateString()}`,
            body: brief,
          },
        },
      });
    });

    return { status: "sent", meetingType, calendarEventId, pipelineId: context.pipelineId };
  }
);

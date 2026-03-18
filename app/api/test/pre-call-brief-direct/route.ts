/**
 * Test route: Run pre-call brief generation DIRECTLY (no Inngest).
 * GET /api/test/pre-call-brief-direct
 *
 * This bypasses Inngest entirely so we can see exactly which step fails.
 * It reuses the most recent calendar_events row, or creates a new one.
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";
import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { resolveLeadFromAttendees } from "@/lib/skyler/calendar/calendar-service";
import { getMemories, formatMemoriesForPrompt } from "@/lib/skyler/memory/agent-memory-store";
import { researchCompany, type CompanyResearch } from "@/lib/skyler/company-research";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";
const LEAD_EMAIL = "prominessltd@gmail.com";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();

    // ── Step 1: Find existing calendar event or create one ──────────────
    let calEvent: Record<string, unknown> | null = null;
    let calEventId = "";

    // Check for a recent calendar event for this lead
    const { data: existingEvent } = await db
      .from("calendar_events")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEvent) {
      calEvent = existingEvent;
      calEventId = existingEvent.id;
      // Reset the brief_sent flag so we can re-run
      await db
        .from("calendar_events")
        .update({ pre_call_brief_sent: false })
        .eq("id", calEventId);
      steps.calendarEvent = { source: "existing", id: calEventId, title: existingEvent.title };
    } else {
      // Create a new calendar event (Outlook + DB) 35 min from now
      const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
      const { data: integration } = await db
        .from("integrations")
        .select("nango_connection_id")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("provider", "outlook")
        .eq("status", "connected")
        .single();

      if (!integration?.nango_connection_id) {
        return NextResponse.json({ steps, error: "No Outlook integration" }, { status: 404 });
      }

      const startTime = new Date(Date.now() + 35 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

      const { data: newEvent, error: insertErr } = await db
        .from("calendar_events")
        .insert({
          workspace_id: WORKSPACE_ID,
          provider: "microsoft_outlook",
          provider_event_id: `test-${Date.now()}`,
          title: "Demo Call — Pre-Call Brief Test",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          timezone: "UTC",
          meeting_url: null,
          meeting_provider: "teams",
          attendees: [{ email: LEAD_EMAIL, name: "Malik" }],
          status: "confirmed",
          event_type: "demo",
          pre_call_brief_sent: false,
        })
        .select("*")
        .single();

      if (insertErr || !newEvent) {
        steps.insertError = insertErr?.message;
        return NextResponse.json({ steps, error: "Failed to create calendar event" }, { status: 500 });
      }

      calEvent = newEvent;
      calEventId = newEvent.id;
      steps.calendarEvent = { source: "created_new", id: calEventId };
    }

    if (!calEvent) {
      return NextResponse.json({ steps, error: "No calendar event available" }, { status: 404 });
    }

    // ── Step 2: Find pipeline record (lead_id > attendee email match) ──
    let resolvedLeadId = calEvent.lead_id as string | null;
    let pipeline: Record<string, unknown> | null = null;

    if (resolvedLeadId) {
      const { data } = await db
        .from("skyler_sales_pipeline")
        .select("*")
        .eq("id", resolvedLeadId)
        .single();
      pipeline = data;
    }

    if (!pipeline) {
      // Match attendee emails against pipeline records
      const attendees = (calEvent.attendees as Array<{ email: string }>) ?? [];
      const emails = attendees.map((a) => a.email).filter(Boolean);
      resolvedLeadId = await resolveLeadFromAttendees(WORKSPACE_ID, emails);

      if (resolvedLeadId) {
        const { data } = await db
          .from("skyler_sales_pipeline")
          .select("*")
          .eq("id", resolvedLeadId)
          .single();
        pipeline = data;

        // Backfill lead_id on the calendar event
        await db
          .from("calendar_events")
          .update({ lead_id: resolvedLeadId, updated_at: new Date().toISOString() })
          .eq("id", calEventId);
        steps.leadIdBackfilled = resolvedLeadId;
      }
    }

    steps.pipeline = pipeline
      ? { id: pipeline.id, name: pipeline.contact_name, company: pipeline.company_name, resolvedVia: calEvent.lead_id ? "lead_id" : "attendee_email_match" }
      : "Not found";

    // ── Step 3: Load agent memories (using correct getMemories function) ─
    const pipelineId = (pipeline?.id as string) ?? null;
    const memories = await getMemories(db, WORKSPACE_ID, pipelineId ?? undefined);
    steps.memories = { count: memories.length, keys: memories.map((m) => m.fact_key) };

    // ── Step 4: Company research (use cached or fetch fresh) ────────────
    let companyResearch: CompanyResearch | null = (pipeline?.company_research as CompanyResearch | null) ?? null;
    if (!companyResearch?.summary && pipeline) {
      try {
        companyResearch = await researchCompany({
          companyName: (pipeline.company_name as string) ?? "",
          contactName: (pipeline.contact_name as string) ?? "",
          contactEmail: (pipeline.contact_email as string) ?? "",
          workspaceId: WORKSPACE_ID,
          pipelineId: pipelineId ?? undefined,
          db,
        });
        steps.companyResearch = { status: "fetched_fresh", confidence: companyResearch.confidence };
      } catch (err: unknown) {
        const e = err as { message?: string };
        steps.companyResearch = { status: "error", message: e.message };
      }
    } else if (companyResearch?.summary) {
      steps.companyResearch = { status: "cached", confidence: companyResearch.confidence };
    } else {
      steps.companyResearch = { status: "no_pipeline_record" };
    }

    // ── Step 5: Classify meeting type ───────────────────────────────────
    const title = ((calEvent.title as string) ?? "").toLowerCase();
    let meetingType = "general";
    if (title.includes("demo")) meetingType = "demo";
    else if (title.includes("intro")) meetingType = "intro";
    else if (title.includes("deep dive")) meetingType = "deep_dive";
    steps.meetingType = meetingType;

    // ── Step 6: Generate brief via Claude ────────────────────────────────
    const attendees = (calEvent.attendees as Array<{ email: string; name?: string }>) ?? [];
    const thread = (pipeline?.conversation_thread as Array<{ role: string; content: string; subject?: string; timestamp: string }>) ?? [];

    const memoriesText = memories.length > 0 ? formatMemoriesForPrompt(memories) : "(None)";

    let companyResearchText = "(No company research available)";
    if (companyResearch?.summary) {
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
      ].filter(Boolean).join("\n");
    }

    const prompt = `Generate a pre-call brief for an upcoming ${meetingType} meeting.

## Meeting Details
- Title: ${calEvent.title ?? "Meeting"}
- Time: ${new Date(calEvent.start_time as string).toLocaleString()}
- Duration: ${Math.round((new Date(calEvent.end_time as string).getTime() - new Date(calEvent.start_time as string).getTime()) / 60000)} minutes
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

Generate a brief with EXACTLY these 5 sections:
1. WHO: Lead name, company, role, how they found us, previous interactions
2. CONTEXT: Pipeline stage, deal value, last activity, outstanding items
3. THEIR WORLD: Company info, challenges, industry insights from research
4. ATTENDEES: Name, role for each attendee. Flag new/unknown attendees.
5. TALKING POINTS: 3-5 specific things to bring up based on meeting type, company research, and conversation history.

Keep it concise. Each section should be 2-4 bullet points max. Use the company research and conversation history to make talking points specific — never generic.`;

    let brief: string;
    try {
      const result = await routedLLMCall({
        task: "pre_call_brief",
        tier: "complex",
        systemPrompt: "You are Skyler, an AI sales assistant. Generate concise, actionable pre-call briefs. Never say 'Unknown' when you have data.",
        userContent: prompt,
        maxTokens: 1500,
      });
      brief = result.text;
      steps.briefGeneration = { status: "ok", length: brief.length, preview: brief.slice(0, 200) + "..." };
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number };
      steps.briefGeneration = { status: "error", message: e.message };
      return NextResponse.json({ steps, error: `Brief generation failed: ${e.message}` }, { status: 500 });
    }

    // ── Step 6: Mark as sent ────────────────────────────────────────────
    await db
      .from("calendar_events")
      .update({ pre_call_brief_sent: true, updated_at: new Date().toISOString() })
      .eq("id", calEventId);
    steps.markedAsSent = true;

    // ── Step 7: Dispatch notification ───────────────────────────────────
    try {
      await dispatchNotification(db, {
        workspaceId: WORKSPACE_ID,
        eventType: "pre_call_brief",
        pipelineId: pipelineId ?? undefined,
        title: `Pre-call brief: ${calEvent.title ?? "Meeting"} with ${pipeline?.contact_name ?? "Unknown"}`,
        body: brief,
        metadata: { calendarEventId: calEventId, meetingType },
      });
      steps.notification = { status: "dispatched" };
    } catch (err: unknown) {
      const e = err as { message?: string };
      steps.notification = { status: "error", message: e.message };
      return NextResponse.json({ steps, error: `Notification dispatch failed: ${e.message}` }, { status: 500 });
    }

    return NextResponse.json({
      status: "ok",
      brief: brief.slice(0, 500) + (brief.length > 500 ? "..." : ""),
      briefLength: brief.length,
      steps,
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({
      steps,
      error: e.message,
      stack: e.stack?.split("\n").slice(0, 8),
    }, { status: 500 });
  }
}

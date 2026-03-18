/**
 * Test route: Create a meeting and run pre-call brief generation DIRECTLY.
 *
 * GET /api/test/pre-call-brief-direct?email=someone@example.com&name=John&minutes=32
 *
 * Query params:
 *  - email: lead's email (required) — used to find pipeline record + create event
 *  - name: lead's name (optional, resolved from pipeline if omitted)
 *  - minutes: minutes from now to schedule meeting (default: 35)
 *  - reuse: if "true", reuse latest calendar event instead of creating new one
 */

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";
import { routedLLMCall } from "@/lib/skyler/routing/model-router";
import { dispatchNotification } from "@/lib/skyler/notifications";
import { resolveLeadFromAttendees } from "@/lib/skyler/calendar/calendar-service";
import { getMemories, formatMemoriesForPrompt } from "@/lib/skyler/memory/agent-memory-store";
import { researchCompany, type CompanyResearch } from "@/lib/skyler/company-research";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET(request: NextRequest) {
  const steps: Record<string, unknown> = {};
  const url = new URL(request.url);
  const leadEmail = url.searchParams.get("email");
  const leadNameParam = url.searchParams.get("name");
  const minutesFromNow = parseInt(url.searchParams.get("minutes") ?? "35", 10);
  const reuseExisting = url.searchParams.get("reuse") === "true";

  if (!leadEmail) {
    return NextResponse.json({
      error: "Missing required query param: email",
      usage: "/api/test/pre-call-brief-direct?email=someone@example.com&name=John&minutes=32",
    }, { status: 400 });
  }

  try {
    const db = createAdminSupabaseClient();

    // ── Step 1: Find pipeline record by email ───────────────────────────
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("*")
      .ilike("contact_email", leadEmail)
      .is("resolution", null)
      .maybeSingle();

    const leadName = leadNameParam || (pipeline?.contact_name as string) || leadEmail.split("@")[0];
    const companyName = (pipeline?.company_name as string) || "";

    steps.pipeline = pipeline
      ? { id: pipeline.id, name: pipeline.contact_name, company: pipeline.company_name, email: pipeline.contact_email, stage: pipeline.stage }
      : `No pipeline record found for ${leadEmail}`;

    // ── Step 2: Get or create calendar event ────────────────────────────
    let calEvent: Record<string, unknown> | null = null;
    let calEventId = "";

    if (reuseExisting) {
      const { data: existing } = await db
        .from("calendar_events")
        .select("*")
        .eq("workspace_id", WORKSPACE_ID)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        calEvent = existing;
        calEventId = existing.id;
        await db.from("calendar_events").update({ pre_call_brief_sent: false }).eq("id", calEventId);
        steps.calendarEvent = { source: "reused_existing", id: calEventId, title: existing.title };
      }
    }

    if (!calEvent) {
      // Create Outlook event + DB row
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

      const connectionId = integration.nango_connection_id;

      // Get timezone
      let timeZone = "UTC";
      try {
        const tzResp = await nango.proxy({
          method: "GET",
          baseUrlOverride: "https://graph.microsoft.com/v1.0",
          endpoint: "/me/mailboxSettings",
          providerConfigKey: "outlook",
          connectionId,
        });
        timeZone = ((tzResp.data as Record<string, unknown>).timeZone as string) ?? "UTC";
      } catch { /* fallback UTC */ }

      // Get organizer email
      let organizerEmail = "";
      try {
        const meResp = await nango.proxy({
          method: "GET",
          baseUrlOverride: "https://graph.microsoft.com/v1.0",
          endpoint: "/me",
          providerConfigKey: "outlook",
          connectionId,
        });
        const me = meResp.data as Record<string, unknown>;
        organizerEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? "";
      } catch { /* non-critical */ }

      const startTime = new Date(Date.now() + minutesFromNow * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

      const meetingTitle = `Demo Call with ${leadName}${companyName ? ` — ${companyName}` : ""}`;

      // Create Outlook event
      const eventResp = await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me/events",
        providerConfigKey: "outlook",
        connectionId,
        data: {
          subject: meetingTitle,
          body: { contentType: "HTML", content: `<p>Meeting with ${leadName} to discuss services.</p>` },
          start: { dateTime: fmt(startTime), timeZone },
          end: { dateTime: fmt(endTime), timeZone },
          attendees: [{ emailAddress: { address: leadEmail, name: leadName }, type: "required" }],
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
        },
      });

      const outlookEvent = eventResp.data as Record<string, unknown>;
      const onlineMeeting = outlookEvent.onlineMeeting as Record<string, unknown> | null;
      const meetingUrl = (onlineMeeting?.joinUrl as string) ?? null;

      // Insert calendar_events row with lead_id resolved
      const { data: newEvent, error: insertErr } = await db
        .from("calendar_events")
        .insert({
          workspace_id: WORKSPACE_ID,
          provider: "microsoft_outlook",
          provider_event_id: outlookEvent.id as string,
          title: meetingTitle,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          timezone: timeZone,
          meeting_url: meetingUrl,
          meeting_provider: "teams",
          organizer_email: organizerEmail,
          attendees: [{ email: leadEmail, name: leadName }],
          status: "confirmed",
          event_type: "demo",
          lead_id: pipeline?.id ?? null,
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
      steps.calendarEvent = {
        source: "created_new",
        id: calEventId,
        title: meetingTitle,
        meetingUrl,
        startsIn: `${minutesFromNow} minutes`,
      };
    }

    if (!calEvent) {
      return NextResponse.json({ steps, error: "No calendar event" }, { status: 404 });
    }

    // ── Step 3: Load agent memories ─────────────────────────────────────
    const pipelineId = (pipeline?.id as string) ?? null;
    const memories = await getMemories(db, WORKSPACE_ID, pipelineId ?? undefined);
    steps.memories = { count: memories.length, keys: memories.map((m) => m.fact_key) };

    // ── Step 4: Company research ────────────────────────────────────────
    let companyResearch: CompanyResearch | null = (pipeline?.company_research as CompanyResearch | null) ?? null;
    if (!companyResearch?.summary && (companyName || leadEmail)) {
      try {
        companyResearch = await researchCompany({
          companyName: companyName || leadEmail.split("@")[1]?.split(".")[0] || "",
          contactName: leadName,
          contactEmail: leadEmail,
          workspaceId: WORKSPACE_ID,
          pipelineId: pipelineId ?? undefined,
          db,
        });
        steps.companyResearch = { status: "fetched_fresh", confidence: companyResearch.confidence };
      } catch (err: unknown) {
        steps.companyResearch = { status: "error", message: (err as { message?: string }).message };
      }
    } else if (companyResearch?.summary) {
      steps.companyResearch = { status: "cached", confidence: companyResearch.confidence };
    } else {
      steps.companyResearch = { status: "skipped" };
    }

    // ── Step 5: Classify meeting type ───────────────────────────────────
    const title = ((calEvent.title as string) ?? "").toLowerCase();
    let meetingType = "general";
    if (title.includes("demo")) meetingType = "demo";
    else if (title.includes("intro")) meetingType = "intro";
    else if (title.includes("deep dive")) meetingType = "deep_dive";
    steps.meetingType = meetingType;

    // ── Step 6: Generate brief ──────────────────────────────────────────
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
      const e = err as { message?: string };
      steps.briefGeneration = { status: "error", message: e.message };
      return NextResponse.json({ steps, error: `Brief generation failed: ${e.message}` }, { status: 500 });
    }

    // ── Step 7: Mark as sent ────────────────────────────────────────────
    await db.from("calendar_events").update({ pre_call_brief_sent: true, updated_at: new Date().toISOString() }).eq("id", calEventId);

    // ── Step 8: Dispatch notification ───────────────────────────────────
    try {
      await dispatchNotification(db, {
        workspaceId: WORKSPACE_ID,
        eventType: "pre_call_brief",
        pipelineId: pipelineId ?? undefined,
        title: `Pre-call brief: ${calEvent.title ?? "Meeting"} with ${leadName}`,
        body: brief,
        metadata: { calendarEventId: calEventId, meetingType, contactName: leadName, companyName },
      });
      steps.notification = { status: "dispatched" };
    } catch (err: unknown) {
      steps.notification = { status: "error", message: (err as { message?: string }).message };
    }

    return NextResponse.json({
      status: "ok",
      lead: { name: leadName, email: leadEmail, company: companyName },
      brief: brief.slice(0, 800) + (brief.length > 800 ? "..." : ""),
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

/**
 * Test route: Check Outlook calendar availability via Nango proxy.
 * GET /api/test/calendar-check
 *
 * Uses nango_connection_id from the integrations table (same as email-sender).
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { Nango } from "@nangohq/node";
import { scoreTimeSlots, type TimeSlot } from "@/lib/skyler/calendar/calendar-service";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    const db = createAdminSupabaseClient();
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // ── Step 1: Get integration row + nango_connection_id ──────────────────
    const { data: integration, error: intErr } = await db
      .from("integrations")
      .select("id, provider, status, nango_connection_id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "outlook")
      .eq("status", "connected")
      .single();

    steps.integration = integration ?? { error: intErr?.message };
    if (!integration?.nango_connection_id) {
      return NextResponse.json({ steps, error: "No connected Outlook integration or missing nango_connection_id" }, { status: 404 });
    }

    const connectionId = integration.nango_connection_id;
    steps.usingConnectionId = connectionId;

    // ── Step 2: Get user email via /me ─────────────────────────────────────
    let userEmail = "";
    try {
      const meResp = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me",
        providerConfigKey: "outlook",
        connectionId,
      });
      const me = meResp.data as Record<string, unknown>;
      userEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? "";
      steps.meProfile = { mail: me.mail, userPrincipalName: me.userPrincipalName };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      steps.meProfile = {
        status: "error",
        statusCode: e.response?.status,
        responseBody: JSON.stringify(e.response?.data ?? "").slice(0, 500),
        message: e.message,
      };
    }

    steps.resolvedEmail = userEmail;

    // ── Step 3: Try getWorkingHours ─────────────────────────────────────────
    let workingHours = null;
    try {
      const resp = await nango.proxy({
        method: "GET",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me/mailboxSettings/workingHours",
        providerConfigKey: "outlook",
        connectionId,
      });
      workingHours = resp.data;
      steps.workingHours = { status: "ok", data: workingHours };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      steps.workingHours = {
        status: "error",
        statusCode: e.response?.status,
        message: e.message,
      };
    }

    // ── Step 4: getSchedule (availability) ──────────────────────────────────
    const now = new Date();
    const endRange = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    if (!userEmail) {
      return NextResponse.json({ steps, error: "Could not resolve user email — getSchedule requires it" }, { status: 400 });
    }

    let availability = null;
    try {
      const resp = await nango.proxy({
        method: "POST",
        baseUrlOverride: "https://graph.microsoft.com/v1.0",
        endpoint: "/me/calendar/getSchedule",
        providerConfigKey: "outlook",
        connectionId,
        data: {
          schedules: [userEmail],
          startTime: { dateTime: now.toISOString(), timeZone: "UTC" },
          endTime: { dateTime: endRange.toISOString(), timeZone: "UTC" },
          availabilityViewInterval: 30,
        },
      });
      availability = resp.data;
      steps.getSchedule = { status: "ok", resultCount: (availability as Record<string, unknown[]>)?.value?.length };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      steps.getSchedule = {
        status: "error",
        statusCode: e.response?.status,
        responseBody: JSON.stringify(e.response?.data ?? "").slice(0, 1000),
        message: e.message,
      };
      return NextResponse.json({ steps, error: "getSchedule failed" }, { status: 500 });
    }

    // ── Step 5: Parse and score ─────────────────────────────────────────────
    const scheduleData = ((availability as Record<string, unknown[]>)?.value?.[0] ?? {}) as Record<string, unknown>;
    const busyBlocks = (scheduleData.scheduleItems ?? []) as Array<{
      start: { dateTime: string };
      end: { dateTime: string };
      status: string;
    }>;

    const wh = (scheduleData.workingHours ?? workingHours) as Record<string, unknown> | null;
    const workStart = (wh?.startTime as string) ?? "09:00";
    const workEnd = (wh?.endTime as string) ?? "17:00";
    const workDayNames = (wh?.daysOfWeek as string[]) ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const dayMap: Record<string, number> = {
      monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
      friday: 5, saturday: 6, sunday: 7,
    };
    const workDayNumbers = workDayNames.map((d) => dayMap[d.toLowerCase()] ?? 0).filter(Boolean);

    const freeSlots = invertBusyToFree(
      busyBlocks.map((b) => ({ start: b.start.dateTime, end: b.end.dateTime })),
      now.toISOString(),
      endRange.toISOString(),
      30,
      workStart,
      workEnd,
      workDayNumbers
    );

    const scored = scoreTimeSlots(freeSlots);

    return NextResponse.json({
      status: "ok",
      steps,
      busyBlockCount: busyBlocks.length,
      busyBlocks: busyBlocks.slice(0, 10).map((b) => ({
        start: b.start.dateTime,
        end: b.end.dateTime,
        status: b.status,
      })),
      totalFreeSlots: freeSlots.length,
      topScoredSlots: scored.map((s) => ({
        start: new Date(s.start).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        end: new Date(s.end).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }),
        score: s.score,
        raw: { start: s.start, end: s.end },
      })),
    });
  } catch (err) {
    return NextResponse.json({
      steps,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

function invertBusyToFree(
  busyBlocks: Array<{ start: string; end: string }>,
  rangeStart: string,
  rangeEnd: string,
  durationMinutes: number,
  workHoursStart: string,
  workHoursEnd: string,
  workDays: number[]
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const durationMs = durationMinutes * 60 * 1000;
  const sorted = [...busyBlocks].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);

  while (current < end) {
    const dayOfWeek = current.getUTCDay();
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    if (workDays.includes(isoDay)) {
      const [startH, startM] = workHoursStart.split(":").map(Number);
      const [endH, endM] = workHoursEnd.split(":").map(Number);
      const dayStart = new Date(current);
      dayStart.setUTCHours(startH, startM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setUTCHours(endH, endM, 0, 0);
      if (dayEnd.getTime() <= new Date().getTime()) {
        current.setUTCDate(current.getUTCDate() + 1);
        continue;
      }
      let cursor = Math.max(dayStart.getTime(), new Date().getTime());
      const dayBusy = sorted.filter((b) => {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        return be > dayStart.getTime() && bs < dayEnd.getTime();
      });
      for (const block of dayBusy) {
        const blockStart = new Date(block.start).getTime();
        while (cursor + durationMs <= blockStart && cursor + durationMs <= dayEnd.getTime()) {
          slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString(), score: 0 });
          cursor += durationMs;
        }
        cursor = Math.max(cursor, new Date(block.end).getTime());
      }
      while (cursor + durationMs <= dayEnd.getTime()) {
        slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString(), score: 0 });
        cursor += durationMs;
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return slots;
}

/**
 * Test route: Check Outlook calendar availability via the new calendar service.
 * GET /api/test/calendar-check
 *
 * Uses the existing Outlook Nango connection (integrations table) directly,
 * since calendar_connections table may not be populated yet.
 */

import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import * as msGraph from "@/lib/skyler/calendar/microsoft-graph-client";
import { scoreTimeSlots, type TimeSlot } from "@/lib/skyler/calendar/calendar-service";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

export async function GET() {
  try {
    const db = createAdminSupabaseClient();

    // 1. Check for Outlook integration
    const { data: integration } = await db
      .from("integrations")
      .select("id, provider, status, nango_connection_id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("provider", "outlook")
      .eq("status", "connected")
      .single();

    if (!integration) {
      return NextResponse.json({
        error: "No connected Outlook integration found",
        workspace: WORKSPACE_ID,
      }, { status: 404 });
    }

    // 2. Get working hours from Outlook
    const workingHours = await msGraph.getWorkingHours(WORKSPACE_ID);

    // 3. Check availability for the next 3 business days
    const now = new Date();
    const endRange = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Find the user's email from Nango connection
    let userEmail = "";
    try {
      const { Nango } = await import("@nangohq/node");
      const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
      const conn = await nango.getConnection("outlook", WORKSPACE_ID);
      userEmail = (conn as unknown as { credentials?: { raw?: { userPrincipalName?: string } } })
        ?.credentials?.raw?.userPrincipalName ?? "";
    } catch {
      userEmail = "unknown";
    }

    const availability = await msGraph.checkAvailability(
      WORKSPACE_ID,
      userEmail,
      now.toISOString(),
      endRange.toISOString()
    );

    // 4. Invert busy blocks into free 30-min slots within work hours
    const workStart = workingHours?.startTime ?? "09:00";
    const workEnd = workingHours?.endTime ?? "17:00";
    const workDays = workingHours?.daysOfWeek ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];

    // Convert Outlook day names to ISO numbers
    const dayMap: Record<string, number> = {
      monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
      friday: 5, saturday: 6, sunday: 7,
    };
    const workDayNumbers = workDays.map((d) => dayMap[d.toLowerCase()] ?? 0).filter(Boolean);

    const freeSlots = invertBusyToFree(
      availability.busyBlocks.map((b) => ({
        start: b.start.dateTime,
        end: b.end.dateTime,
      })),
      now.toISOString(),
      endRange.toISOString(),
      30,
      workStart,
      workEnd,
      workDayNumbers
    );

    // 5. Score the slots
    const scored = scoreTimeSlots(freeSlots);

    return NextResponse.json({
      status: "ok",
      workspace: WORKSPACE_ID,
      provider: "outlook",
      userEmail,
      workingHours: workingHours
        ? { start: workingHours.startTime, end: workingHours.endTime, days: workingHours.daysOfWeek, tz: workingHours.timeZone }
        : null,
      busyBlockCount: availability.busyBlocks.length,
      busyBlocks: availability.busyBlocks.slice(0, 10).map((b) => ({
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
    console.error("[test/calendar-check] Error:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

// ── Helper: invert busy blocks into free slots ──────────────────────────────

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

      // Skip if day is in the past
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
        // Generate slots in the gap before this busy block
        while (cursor + durationMs <= blockStart && cursor + durationMs <= dayEnd.getTime()) {
          slots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(cursor + durationMs).toISOString(),
            score: 0,
          });
          cursor += durationMs;
        }
        cursor = Math.max(cursor, new Date(block.end).getTime());
      }

      // Fill remaining time after last busy block
      while (cursor + durationMs <= dayEnd.getTime()) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + durationMs).toISOString(),
          score: 0,
        });
        cursor += durationMs;
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return slots;
}

/**
 * GET /api/skyler/track/open?tid=<tracking_id>
 *
 * Serves a 1x1 transparent GIF and records the email open event.
 * Called when the recipient's email client loads the tracking pixel.
 * No auth required — this is loaded by the recipient's mail client.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TRANSPARENT_GIF } from "@/lib/skyler/open-tracking";

export async function GET(req: NextRequest) {
  const tid = req.nextUrl.searchParams.get("tid");

  // Always return the pixel — even if tid is missing or invalid
  const pixelResponse = () =>
    new NextResponse(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": String(TRANSPARENT_GIF.length),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });

  if (!tid) return pixelResponse();

  try {
    const db = createAdminSupabaseClient();

    // Look up the tracking record
    const { data: tracker } = await db
      .from("skyler_email_opens")
      .select("id, pipeline_id, workspace_id, open_count")
      .eq("tracking_id", tid)
      .maybeSingle();

    if (!tracker) {
      // Unknown tracking ID — still return the pixel
      console.log(`[open-tracking] Unknown tracking ID: ${tid}`);
      return pixelResponse();
    }

    const now = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // Update the tracking record with open data
    await db
      .from("skyler_email_opens")
      .update({
        open_count: (tracker.open_count ?? 0) + 1,
        first_opened_at: tracker.open_count === 0 ? now : undefined,
        last_opened_at: now,
        ip_address: ip,
        user_agent: userAgent,
      })
      .eq("id", tracker.id);

    // Update the pipeline record's open tracking
    const { data: pipeline } = await db
      .from("skyler_sales_pipeline")
      .select("email_opens")
      .eq("id", tracker.pipeline_id)
      .maybeSingle();

    if (pipeline) {
      await db
        .from("skyler_sales_pipeline")
        .update({
          email_opens: (pipeline.email_opens ?? 0) + 1,
          last_email_opened_at: now,
          updated_at: now,
        })
        .eq("id", tracker.pipeline_id);
    }

    console.log(`[open-tracking] Recorded open for ${tid} (pipeline: ${tracker.pipeline_id}, count: ${(tracker.open_count ?? 0) + 1})`);
  } catch (err) {
    // Never fail — always return the pixel
    console.error("[open-tracking] Error recording open:", err instanceof Error ? err.message : err);
  }

  return pixelResponse();
}

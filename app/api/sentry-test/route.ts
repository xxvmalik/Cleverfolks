import { NextResponse } from "next/server";

export async function GET() {
  throw new Error("Sentry test error — this is intentional");
}

export async function POST() {
  return NextResponse.json({
    message: "Sentry test error thrown on GET. Visit /api/sentry-test to trigger it.",
  });
}

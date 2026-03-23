import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Initialise Sentry for the Node.js server runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });

    // Validate environment variables on server startup
    const { validateEnv } = await import("./lib/env");
    const result = validateEnv();
    if (!result.valid) {
      console.error("[startup] Server cannot start — missing required environment variables.");
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required environment variables: ${result.missing.map((m) => m.split(" — ")[0]).join(", ")}`);
      }
    }
  }

  // Initialise Sentry for the Edge runtime
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;

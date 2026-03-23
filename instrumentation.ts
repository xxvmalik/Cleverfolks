export async function register() {
  // Validate environment variables on server startup
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    const result = validateEnv();
    if (!result.valid) {
      console.error("[startup] Server cannot start — missing required environment variables.");
      // In production, throw to prevent starting with missing config
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required environment variables: ${result.missing.map((m) => m.split(" — ")[0]).join(", ")}`);
      }
    }
  }
}

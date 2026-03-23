/**
 * Environment variable validation.
 * Import this module early (e.g. in layout.tsx or instrumentation.ts)
 * to fail fast if required vars are missing.
 */

type EnvVar = {
  key: string;
  required: boolean;
  description: string;
};

const ENV_VARS: EnvVar[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: true, description: "Supabase project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, description: "Supabase anonymous key" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: true, description: "Supabase service role key (server only)" },
  { key: "ANTHROPIC_API_KEY", required: true, description: "Anthropic API key for Claude" },
  { key: "NANGO_SECRET_KEY", required: true, description: "Nango server-side secret key" },
  { key: "OPENAI_API_KEY", required: true, description: "OpenAI API key for embeddings and Whisper" },
  { key: "VOYAGE_API_KEY", required: true, description: "Voyage AI API key for document embeddings" },
  { key: "RESEND_API_KEY", required: true, description: "Resend API key for transactional emails" },
  { key: "TAVILY_API_KEY", required: false, description: "Tavily API key for web search (optional)" },
  { key: "RECALL_AI_API_KEY", required: false, description: "Recall AI API key for meeting recording (optional)" },
  { key: "RECALL_WEBHOOK_SECRET", required: false, description: "Recall AI webhook secret (optional)" },
  { key: "NEXT_PUBLIC_NANGO_PUBLIC_KEY", required: false, description: "Nango public key for frontend OAuth" },
  { key: "APOLLO_API_KEY", required: false, description: "Apollo API key for contact enrichment (optional)" },
  { key: "GOOGLE_CALENDAR_CLIENT_ID", required: false, description: "Google Calendar OAuth client ID (optional)" },
  { key: "GOOGLE_CALENDAR_CLIENT_SECRET", required: false, description: "Google Calendar OAuth client secret (optional)" },
];

export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of ENV_VARS) {
    const value = process.env[v.key];
    if (!value?.trim()) {
      if (v.required) {
        missing.push(`${v.key} — ${v.description}`);
      } else {
        warnings.push(`${v.key} — ${v.description}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n[env] Missing required environment variables:\n${missing.map((m) => `  - ${m}`).join("\n")}\n`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `[env] Optional environment variables not set: ${warnings.map((w) => w.split(" — ")[0]).join(", ")}`
    );
  }

  return { valid: missing.length === 0, missing, warnings };
}

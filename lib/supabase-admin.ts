import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted server-side code (e.g. Inngest
 * background functions) that runs without user session cookies.
 * Bypasses RLS — only use inside server-side/background job code.
 *
 * Required env var: SUPABASE_SERVICE_ROLE_KEY
 */
export function createAdminSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Directive Store for Skyler.
 *
 * CRUD operations for per-lead user directives.
 * Directives persist until the lead is closed or the user deactivates them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Directive = {
  id: string;
  directive_text: string;
  created_at: string;
  is_active: boolean;
};

/** Save a new directive for a pipeline lead */
export async function saveDirective(
  db: SupabaseClient,
  workspaceId: string,
  pipelineId: string,
  directiveText: string
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("skyler_directives")
    .insert({
      workspace_id: workspaceId,
      pipeline_id: pipelineId,
      directive_text: directiveText,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[directive-store] Save failed:", error.message);
    return null;
  }
  return data;
}

/** Get all active directives for a pipeline lead */
export async function getActiveDirectives(
  db: SupabaseClient,
  pipelineId: string
): Promise<Directive[]> {
  const { data, error } = await db
    .from("skyler_directives")
    .select("id, directive_text, created_at, is_active")
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[directive-store] Fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as Directive[];
}

/** Deactivate a specific directive */
export async function deactivateDirective(
  db: SupabaseClient,
  directiveId: string
): Promise<boolean> {
  const { error } = await db
    .from("skyler_directives")
    .update({ is_active: false })
    .eq("id", directiveId);

  if (error) {
    console.error("[directive-store] Deactivate failed:", error.message);
    return false;
  }
  return true;
}

/** Deactivate all directives for a pipeline lead (e.g. when deal is closed) */
export async function deactivateAllDirectives(
  db: SupabaseClient,
  pipelineId: string
): Promise<void> {
  await db
    .from("skyler_directives")
    .update({ is_active: false })
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true);
}

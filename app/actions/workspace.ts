"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createWorkspace } from "@/lib/workspace";

export async function createWorkspaceAction(
  name: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated. Please sign in again." };
  }

  const { error } = await createWorkspace(supabase, name);

  if (error) {
    return { error: error.message };
  }

  return {};
}

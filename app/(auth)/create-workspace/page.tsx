"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateSlug } from "@/lib/workspace";
import { createWorkspaceAction } from "@/app/actions/workspace";

export default function CreateWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Debug: show what the browser-side Supabase client sees.
      // Open DevTools → Console to read this before the insert fires.
      const { data: { session } } = await supabase.auth.getSession();
      console.log("[create-workspace] client-side session:", {
        userId: session?.user?.id ?? null,
        hasAccessToken: !!session?.access_token,
        expiresAt: session?.expires_at ?? null,
      });

      // Use a Server Action so the insert runs server-side with
      // createServerSupabaseClient, which reads session cookies
      // from the request directly — no cookie-assembly issues.
      const result = await createWorkspaceAction(name);

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.workspaceId) {
        throw new Error("Workspace was created but no ID was returned. Please refresh and try again.");
      }

      console.log("[create-workspace] Created workspace:", result.workspaceId);
      router.push("/");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to create workspace";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-heading font-bold text-2xl text-white tracking-tight">
            Create your workspace
          </h1>
          <p className="text-[#8B8F97] text-sm">
            A workspace is where your team collaborates.
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-[#F87171]/10 border border-[#F87171]/30 text-[#F87171] text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-[#8B8F97]" htmlFor="name">
              Workspace name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors"
              placeholder="Acme Inc."
            />
            {name && (
              <p className="text-xs text-[#8B8F97]">
                Slug:{" "}
                <span className="text-white font-mono">{generateSlug(name)}</span>
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 rounded-lg bg-[#3A89FF] text-white text-sm font-medium hover:bg-[#3A89FF]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}

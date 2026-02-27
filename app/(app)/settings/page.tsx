"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/workspace-context";
import { supabase } from "@/lib/supabase";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace";

export default function SettingsPage() {
  const { currentWorkspace } = useWorkspace();
  const [businessContext, setBusinessContext] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!currentWorkspace) return;
    setLoading(true);
    supabase
      .from("workspaces")
      .select("settings")
      .eq("id", currentWorkspace.id)
      .single()
      .then(({ data }) => {
        const settings = (data?.settings as Record<string, unknown>) ?? {};
        setBusinessContext((settings.business_context as string) ?? "");
        setLoading(false);
      });
  }, [currentWorkspace]);

  async function handleSave() {
    if (!currentWorkspace) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateWorkspaceSettingsAction(currentWorkspace.id, {
      business_context: businessContext.trim(),
    });
    if (result.error) {
      setError(result.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Settings</h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Configure{" "}
          <span className="text-white">{currentWorkspace?.name}</span>
        </p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-white font-medium">CleverBrain context</h2>
          <p className="text-[#8B8F97] text-sm mt-0.5">
            Teach CleverBrain your business language so it interprets messages correctly — service IDs, internal
            jargon, acronyms, and more.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-[#8B8F97]">
            Business language &amp; terminology
          </label>
          {loading ? (
            <div className="h-32 rounded-lg bg-[#131619] border border-[#2A2D35] animate-pulse" />
          ) : (
            <textarea
              value={businessContext}
              onChange={(e) => setBusinessContext(e.target.value)}
              rows={8}
              placeholder={`Service IDs are 4-digit numbers (e.g., 1467). When staff say "[number] failed", it means orders for that service are failing.\nOrder IDs are 6-7 digit numbers (e.g., 6543872). These appear with actions like "speed up", "refill", or "cancel".\n"SMM" refers to Social Media Marketing panel services, our core product.`}
              className="w-full px-3 py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors resize-none font-mono"
            />
          )}
        </div>

        {error && <p className="text-[#F87171] text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-[#3A89FF] text-white text-sm font-medium hover:bg-[#3A89FF]/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span className="text-[#4ADE80] text-sm">Saved successfully.</span>
          )}
        </div>
      </div>
    </div>
  );
}

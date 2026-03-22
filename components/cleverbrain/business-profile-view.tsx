"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

type BusinessProfile = {
  company_name?: string;
  company_description?: string;
  industry?: string;
  company_stage?: string;
  team_size?: string;
  website?: string;
  target_audience?: string;
  differentiator?: string;
};

type BrandData = {
  brand_voice?: string[];
  tagline?: string;
};

type GoalsData = {
  focus_areas?: string[];
  bottleneck?: string;
};

type WorkspaceSettings = {
  business_profile?: BusinessProfile;
  brand?: BrandData;
  goals?: GoalsData;
};

type InfoRow = {
  label: string;
  key: string;
  value: string;
};

export function BusinessProfileView({
  workspaceId,
  companyName,
}: {
  workspaceId: string;
  companyName?: string;
}) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace-settings?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings ?? {});
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const bp = settings?.business_profile ?? {};
  const brand = settings?.brand ?? {};
  const goals = settings?.goals ?? {};

  const basicInfo: InfoRow[] = [
    { label: "Company", key: "company_name", value: bp.company_name || companyName || "—" },
    { label: "Industry", key: "industry", value: bp.industry || "—" },
    { label: "Size", key: "team_size", value: bp.team_size ? `${bp.team_size} Employees` : "—" },
    { label: "Stage", key: "company_stage", value: bp.company_stage || "—" },
    { label: "Website", key: "website", value: bp.website || "—" },
  ];

  const preferences: InfoRow[] = [
    { label: "Brand Voice", key: "brand_voice", value: (brand.brand_voice ?? []).join(", ") || "—" },
    { label: "Target Audience", key: "target_audience", value: bp.target_audience || "—" },
    { label: "Priority Areas", key: "focus_areas", value: (goals.focus_areas ?? []).join(", ") || "—" },
    { label: "Differentiator", key: "differentiator", value: bp.differentiator || "—" },
  ];

  function startEditing() {
    const values: Record<string, string> = {};
    basicInfo.forEach((row) => { values[row.key] = row.value === "—" ? "" : row.value.replace(" Employees", ""); });
    setEditValues(values);
    setEditing(true);
  }

  async function saveEdits() {
    setSaving(true);
    try {
      const updatedProfile: Record<string, string> = { ...bp };
      Object.entries(editValues).forEach(([key, val]) => {
        if (val) updatedProfile[key] = val;
      });

      await fetch("/api/workspace-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          settings: { business_profile: updatedProfile },
        }),
      });

      await loadSettings();
      setEditing(false);
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[#8B8F97]" />
      </div>
    );
  }

  return (
    <div className="px-8 py-6 max-w-3xl">
      <h1 className="text-white font-bold text-xl mb-8">
        Business Profile: {bp.company_name || companyName || "Your Company"}
      </h1>

      {/* Basic Information */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-base">Basic Information</h2>
          {!editing ? (
            <button
              onClick={startEditing}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-[#3A89FF] hover:bg-[#3A89FF]/90 transition-colors inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#8B8F97] hover:text-white transition-colors inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-[#4ADE80] hover:bg-[#4ADE80]/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          {basicInfo.map((row) => (
            <div
              key={row.key}
              className="flex items-center py-3 px-4 rounded-lg"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <span className="text-sm text-[#8B8F97] w-[140px] flex-shrink-0">{row.label}</span>
              {editing ? (
                <input
                  type="text"
                  value={editValues[row.key] ?? ""}
                  onChange={(e) => setEditValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
                  className="flex-1 bg-[#0A1929] border border-[#1E3A5F] rounded px-3 py-1 text-sm text-white outline-none focus:border-[#3A89FF]/50"
                />
              ) : (
                <span className="text-sm text-white">{row.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="text-white font-semibold text-base mb-4">Preferences</h2>
        <div className="space-y-1">
          {preferences.map((row) => (
            <div
              key={row.key}
              className="flex items-center py-3 px-4 rounded-lg"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <span className="text-sm text-[#8B8F97] w-[140px] flex-shrink-0">{row.label}</span>
              <span className="text-sm text-white">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

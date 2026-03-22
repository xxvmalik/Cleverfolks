"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

type WorkspaceSettings = {
  business_profile?: Record<string, unknown>;
  brand?: Record<string, unknown>;
  products?: Array<Record<string, unknown>>;
  competitors?: Array<Record<string, unknown>>;
  goals?: Record<string, unknown>;
};

function SectionHeader({
  title,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-white font-semibold text-base">{title}</h2>
      {!editing ? (
        <button
          onClick={onEdit}
          className="px-3 py-1 rounded-lg text-xs font-medium text-[#3A89FF] border border-[#3A89FF]/30 hover:bg-[#3A89FF]/10 transition-colors inline-flex items-center gap-1.5"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-1 rounded-lg text-xs font-medium text-[#8B8F97] hover:text-white transition-colors inline-flex items-center gap-1">
            <X className="w-3 h-3" /> Cancel
          </button>
          <button onClick={onSave} disabled={saving} className="px-3 py-1 rounded-lg text-xs font-medium text-white bg-[#4ADE80] hover:bg-[#4ADE80]/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
      <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">{label}</span>
      <span className="text-sm text-white flex-1">{value || "—"}</span>
    </div>
  );
}

function EditRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
      <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-[#0A1929] border border-[#1E3A5F] rounded px-3 py-1 text-sm text-white outline-none focus:border-[#3A89FF]/50"
      />
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-sm text-[#8B8F97]">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#3A89FF]/10 text-[#3A89FF] border border-[#3A89FF]/20">
          {item}
        </span>
      ))}
    </div>
  );
}

export function BusinessProfileView({
  workspaceId,
  companyName,
}: {
  workspaceId: string;
  companyName?: string;
}) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<string | null>(null);
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

  async function saveSection(settingsKey: string, data: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch("/api/workspace-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, settings: { [settingsKey]: data } }),
      });
      await loadSettings();
      setEditingSection(null);
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

  const bp = (settings?.business_profile ?? {}) as Record<string, string>;
  const brand = (settings?.brand ?? {}) as Record<string, unknown>;
  const products = (settings?.products ?? []) as Array<{ name?: string; description?: string }>;
  const competitors = (settings?.competitors ?? []) as Array<{ name?: string }>;
  const goals = (settings?.goals ?? {}) as Record<string, unknown>;
  const brandVoice = (brand.brand_voice ?? []) as string[];
  const focusAreas = (goals.focus_areas ?? []) as string[];
  const competitorNames = competitors.map((c) => c.name).filter(Boolean) as string[];

  const isEditing = (section: string) => editingSection === section;

  function startEdit(section: string, values: Record<string, string>) {
    setEditValues(values);
    setEditingSection(section);
  }

  return (
    <div className="px-8 py-6 max-w-3xl overflow-y-auto">
      <h1 className="text-white font-bold text-xl mb-8">
        Business Profile: {bp.company_name || companyName || "Your Company"}
      </h1>

      {/* ── Basic Information ──────────────────────────────────────── */}
      <div className="mb-8">
        <SectionHeader
          title="Basic Information"
          editing={isEditing("basic")}
          onEdit={() => startEdit("basic", {
            company_name: bp.company_name || "",
            industry: bp.industry || "",
            team_size: bp.team_size || "",
            company_stage: bp.company_stage || "",
            website: bp.website || "",
            company_description: bp.company_description || "",
          })}
          onCancel={() => setEditingSection(null)}
          onSave={() => saveSection("business_profile", { ...bp, ...editValues })}
          saving={saving}
        />
        <div className="space-y-1">
          {isEditing("basic") ? (
            <>
              <EditRow label="Company" value={editValues.company_name ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, company_name: v }))} />
              <EditRow label="Industry" value={editValues.industry ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, industry: v }))} />
              <EditRow label="Team Size" value={editValues.team_size ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, team_size: v }))} />
              <EditRow label="Stage" value={editValues.company_stage ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, company_stage: v }))} />
              <EditRow label="Website" value={editValues.website ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, website: v }))} />
              <div className="py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                <span className="text-sm text-[#8B8F97] block mb-1">Description</span>
                <textarea
                  value={editValues.company_description ?? ""}
                  onChange={(e) => setEditValues((p) => ({ ...p, company_description: e.target.value }))}
                  rows={3}
                  className="w-full bg-[#0A1929] border border-[#1E3A5F] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#3A89FF]/50 resize-none"
                />
              </div>
            </>
          ) : (
            <>
              <InfoRow label="Company" value={bp.company_name || companyName || ""} />
              <InfoRow label="Industry" value={bp.industry || ""} />
              <InfoRow label="Team Size" value={bp.team_size ? `${bp.team_size} employees` : ""} />
              <InfoRow label="Stage" value={bp.company_stage || ""} />
              <InfoRow label="Website" value={bp.website || ""} />
              <InfoRow label="Description" value={bp.company_description || ""} />
            </>
          )}
        </div>
      </div>

      {/* ── Market ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <SectionHeader
          title="Market"
          editing={isEditing("market")}
          onEdit={() => startEdit("market", {
            target_audience: bp.target_audience || "",
            differentiator: bp.differentiator || "",
            business_model: bp.business_model || "",
          })}
          onCancel={() => setEditingSection(null)}
          onSave={() => saveSection("business_profile", { ...bp, ...editValues })}
          saving={saving}
        />
        <div className="space-y-1">
          {isEditing("market") ? (
            <>
              <EditRow label="Business Model" value={editValues.business_model ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, business_model: v }))} />
              <EditRow label="Target Audience" value={editValues.target_audience ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, target_audience: v }))} />
              <EditRow label="Differentiator" value={editValues.differentiator ?? ""} onChange={(v) => setEditValues((p) => ({ ...p, differentiator: v }))} />
            </>
          ) : (
            <>
              <InfoRow label="Business Model" value={bp.business_model || ""} />
              <InfoRow label="Target Audience" value={bp.target_audience || ""} />
              <InfoRow label="Differentiator" value={bp.differentiator || ""} />
            </>
          )}
          <div className="flex py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">Competitors</span>
            <TagList items={competitorNames} />
          </div>
        </div>
      </div>

      {/* ── Brand ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-white font-semibold text-base mb-4">Brand</h2>
        <div className="space-y-1">
          <div className="flex py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">Brand Voice</span>
            <TagList items={brandVoice} />
          </div>
          <InfoRow label="Tagline" value={(brand.tagline as string) || ""} />
          {brand.primary_color ? (
            <div className="flex items-center py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
              <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">Colors</span>
              <div className="flex items-center gap-3">
                {([brand.primary_color, brand.secondary_color, brand.accent_color].filter(Boolean) as string[]).map((color) => (
                  <div key={color} className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded border border-[#2A2D35]" style={{ background: color }} />
                    <span className="text-xs text-white font-mono">{color}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {(brand.heading_font || brand.body_font) ? (
            <InfoRow label="Fonts" value={([brand.heading_font, brand.body_font].filter(Boolean) as string[]).join(" / ")} />
          ) : null}
        </div>
      </div>

      {/* ── Products ───────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-white font-semibold text-base mb-4">Products & Services</h2>
        {products.length > 0 ? (
          <div className="space-y-2">
            {products.map((product, i) => (
              <div key={i} className="py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                <span className="text-sm text-white font-medium">{product.name || `Product ${i + 1}`}</span>
                {product.description && (
                  <p className="text-xs text-[#8B8F97] mt-1">{product.description}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-3 px-4 rounded-lg text-sm text-[#8B8F97]" style={{ background: "rgba(255,255,255,0.02)" }}>
            No products added yet
          </div>
        )}
        {bp.pricing_model && (
          <div className="mt-2">
            <InfoRow label="Pricing Model" value={bp.pricing_model} />
          </div>
        )}
      </div>

      {/* ── Goals ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-white font-semibold text-base mb-4">Goals</h2>
        <div className="space-y-1">
          <div className="flex py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="text-sm text-[#8B8F97] w-[160px] flex-shrink-0">Focus Areas</span>
            <TagList items={focusAreas} />
          </div>
          <InfoRow label="Biggest Bottleneck" value={(goals.bottleneck as string) || ""} />
        </div>
      </div>
    </div>
  );
}

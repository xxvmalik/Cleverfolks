"use client";

import { useState } from "react";
import { User, Users, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type UserProfile = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string;
};

type TeamSettings = {
  role: string;
  timezone: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  language: string;
};

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
};

type SettingsTab = "profile" | "team";

export function SettingsClient({
  workspaceId,
  workspaceName,
  userProfile,
  teamSettings: initialTeamSettings,
  members,
}: {
  workspaceId: string;
  workspaceName: string;
  userProfile: UserProfile;
  teamSettings: TeamSettings;
  members: Member[];
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [teamSettings, setTeamSettings] = useState(initialTeamSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
    { id: "profile", label: "User Profile", icon: User },
    { id: "team", label: "Team", icon: Users },
  ];

  async function saveTeamSettings() {
    setSaving(true);
    try {
      await fetch("/api/workspace-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          settings: { team: {
            role: teamSettings.role,
            timezone: teamSettings.timezone,
            working_hours_start: teamSettings.workingHoursStart,
            working_hours_end: teamSettings.workingHoursEnd,
            language: teamSettings.language,
          }},
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#131619]">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-white font-bold text-2xl">Settings</h1>
          <p className="text-[#8B8F97] text-sm mt-1">{workspaceName}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-[#2A2D35]/40 mb-8">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "pb-3 text-sm transition-colors flex items-center gap-2",
                  activeTab === tab.id
                    ? "text-white border-b-2 border-[#3A89FF] font-medium"
                    : "text-[#8B8F97] hover:text-white"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-6">
              <div className="flex items-center gap-4 mb-6">
                {userProfile.avatarUrl ? (
                  <img src={userProfile.avatarUrl} alt="" className="w-16 h-16 rounded-full" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-[#3A89FF]/20 flex items-center justify-center">
                    <User className="w-7 h-7 text-[#3A89FF]" />
                  </div>
                )}
                <div>
                  <h2 className="text-white font-semibold text-lg">{userProfile.fullName || "User"}</h2>
                  <p className="text-[#8B8F97] text-sm">{userProfile.email}</p>
                </div>
              </div>

              <div className="space-y-1">
                <InfoRow label="Full Name" value={userProfile.fullName || "—"} />
                <InfoRow label="Email" value={userProfile.email} />
                <InfoRow label="User ID" value={userProfile.id} />
              </div>
            </div>
          </div>
        )}

        {/* Team Tab */}
        {activeTab === "team" && (
          <div className="space-y-6">
            {/* Work Settings */}
            <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-6">
              <h3 className="text-white font-semibold text-base mb-4">Work Settings</h3>
              <div className="space-y-4">
                <SettingsField
                  label="Your Role"
                  value={teamSettings.role}
                  onChange={(v) => setTeamSettings((p) => ({ ...p, role: v }))}
                  placeholder="e.g. CEO, Sales Lead, Marketing Manager"
                />
                <SettingsField
                  label="Timezone"
                  value={teamSettings.timezone}
                  onChange={(v) => setTeamSettings((p) => ({ ...p, timezone: v }))}
                  placeholder="e.g. Europe/London"
                />
                <div className="flex gap-4">
                  <SettingsField
                    label="Working Hours Start"
                    value={teamSettings.workingHoursStart}
                    onChange={(v) => setTeamSettings((p) => ({ ...p, workingHoursStart: v }))}
                    placeholder="09:00"
                    type="time"
                  />
                  <SettingsField
                    label="Working Hours End"
                    value={teamSettings.workingHoursEnd}
                    onChange={(v) => setTeamSettings((p) => ({ ...p, workingHoursEnd: v }))}
                    placeholder="17:00"
                    type="time"
                  />
                </div>
                <SettingsField
                  label="Preferred Language"
                  value={teamSettings.language}
                  onChange={(v) => setTeamSettings((p) => ({ ...p, language: v }))}
                  placeholder="English"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#2A2D35]">
                {saved && (
                  <span className="flex items-center gap-1.5 text-[#4ADE80] text-xs font-medium">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
                <button
                  onClick={saveTeamSettings}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#3A89FF] hover:bg-[#3A89FF]/90 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>

            {/* Team Members */}
            <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-xl p-6">
              <h3 className="text-white font-semibold text-base mb-4">Team Members</h3>
              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#3A89FF]/15 flex items-center justify-center">
                        <User className="w-4 h-4 text-[#3A89FF]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{member.name}</p>
                      <p className="text-xs text-[#8B8F97] truncate">{member.email}</p>
                    </div>
                    <span className="text-xs text-[#8B8F97] px-2.5 py-1 rounded-full bg-[#2A2D35] capitalize">
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex py-3 px-4 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
      <span className="text-sm text-[#8B8F97] w-[140px] flex-shrink-0">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  );
}

function SettingsField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex-1">
      <label className="text-xs text-[#8B8F97] block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#131619] border border-[#2A2D35] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#8B8F97]/40 outline-none focus:border-[#3A89FF]/50 transition-colors"
      />
    </div>
  );
}

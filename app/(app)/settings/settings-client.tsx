"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, Users, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/context/workspace-context";

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
    <div className="flex h-screen w-full overflow-hidden bg-[#131619]">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
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

      {/* Right Icon Bar */}
      <SettingsRightIconBar />
    </div>
  );
}

function SettingsRightIconBar() {
  const { currentWorkspace, workspaces, setCurrentWorkspace } = useWorkspace();
  const router = useRouter();
  const [wsOverlayOpen, setWsOverlayOpen] = useState(false);

  const wsInitial = currentWorkspace?.name
    ?.split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 1) || "W";

  return (
    <div className="w-[76px] border-l border-[#2A2D35]/60 flex flex-col items-center justify-between py-6 flex-shrink-0 relative bg-[#131619]">
      <div />

      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#2A2D35]/60 px-3 py-5" style={{ background: "#1F1F1FCC" }}>
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png" alt="CleverBrain" width={36} height={36} />
        </Link>
        <Link href="/skyler" title="Skyler" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/skyler-icon.png" alt="Skyler" width={36} height={36} className="rounded-full" />
        </Link>
        <Link href="/connectors" title="Connectors" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/conectors-icon.png" alt="Connectors" width={34} height={34} />
        </Link>
        <Link href="/cleverbrain/hireaiemployee" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/hire-ai-employee-icon.png" alt="AI Employees" width={34} height={34} />
        </Link>
        <Link href="/settings" title="Settings" className="opacity-100 ring-2 ring-[#3A89FF]/40 rounded-lg transition-opacity">
          <Image src="/cleverbrain-chat-icons/organization-icon.png" alt="Settings" width={36} height={36} />
        </Link>
      </div>

      <button
        onClick={() => setWsOverlayOpen((v) => !v)}
        title={currentWorkspace?.name || "Workspace"}
        className="w-10 h-10 rounded-full bg-[#3A89FF] flex items-center justify-center text-white text-sm font-bold hover:ring-2 hover:ring-[#3A89FF]/40 transition-all"
      >
        {wsInitial}
      </button>

      {wsOverlayOpen && currentWorkspace && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setWsOverlayOpen(false)} />
          <div className="absolute right-[84px] bottom-4 w-64 bg-[#1E1E1E] border border-[#2A2D35] rounded-xl py-2 z-50 shadow-2xl">
            <div className="px-4 py-2 border-b border-[#2A2D35]">
              <p className="text-[#8B8F97] text-xs uppercase tracking-wider mb-1">Current workspace</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#3A89FF] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {currentWorkspace.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <span className="text-white text-sm font-medium truncate">{currentWorkspace.name}</span>
              </div>
            </div>

            {workspaces.length > 1 && (
              <div className="py-1 border-b border-[#2A2D35]">
                {workspaces
                  .filter((ws) => ws.id !== currentWorkspace.id)
                  .map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        setCurrentWorkspace(ws);
                        setWsOverlayOpen(false);
                        router.refresh();
                      }}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[#8B8F97] hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-md bg-[#3A89FF]/20 flex items-center justify-center text-[#3A89FF] text-xs font-bold flex-shrink-0">
                        {ws.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="truncate">{ws.name}</span>
                    </button>
                  ))}
              </div>
            )}

            <Link
              href="/create-workspace"
              onClick={() => setWsOverlayOpen(false)}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#8B8F97] hover:text-white hover:bg-white/5 transition-colors"
            >
              <div className="w-6 h-6 rounded-md border border-dashed border-[#8B8F97]/40 flex items-center justify-center text-[#8B8F97] text-xs">
                +
              </div>
              <span>Create new workspace</span>
            </Link>
          </div>
        </>
      )}
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

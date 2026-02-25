"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/context/workspace-context";
import { getWorkspaceMembers, inviteTeamMember } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";

type Member = {
  user_id: string;
  role: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
};

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return "?";
}

const ROLE_COLORS: Record<string, string> = {
  owner: "text-[#D4FF00] bg-[#D4FF00]/10 border-[#D4FF00]/30",
  admin: "text-[#3A89FF] bg-[#3A89FF]/10 border-[#3A89FF]/30",
  member: "text-[#8B8F97] bg-[#8B8F97]/10 border-[#2A2D35]",
};

export default function TeamPage() {
  const { currentWorkspace } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const canManage =
    currentWorkspace?.role === "owner" || currentWorkspace?.role === "admin";

  useEffect(() => {
    if (!currentWorkspace) return;
    setLoading(true);
    getWorkspaceMembers(supabase, currentWorkspace.id).then(({ data }) => {
      setMembers((data as unknown as Member[]) ?? []);
      setLoading(false);
    });
  }, [currentWorkspace]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspace) return;
    setInviteError(null);
    setInviteSuccess(false);
    setInviting(true);

    const { error } = await inviteTeamMember(
      supabase,
      currentWorkspace.id,
      inviteEmail,
      inviteRole
    );

    if (error) {
      setInviteError(error.message);
    } else {
      setInviteSuccess(true);
      setInviteEmail("");
      // Refresh member list
      const { data } = await getWorkspaceMembers(supabase, currentWorkspace.id);
      setMembers((data as unknown as Member[]) ?? []);
    }
    setInviting(false);
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen p-8">
        <div className="text-center space-y-2">
          <h2 className="text-white font-heading font-bold text-xl">Access denied</h2>
          <p className="text-[#8B8F97] text-sm">
            You need owner or admin permissions to manage team members.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Team</h1>
        <p className="text-[#8B8F97] text-sm mt-1">
          Manage members of{" "}
          <span className="text-white">{currentWorkspace?.name}</span>
        </p>
      </div>

      {/* Invite form */}
      <div className="bg-[#131619] border border-[#2A2D35] rounded-xl p-6 space-y-4">
        <h2 className="text-white font-medium">Invite a member</h2>
        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
            className="flex-1 px-3 py-2.5 rounded-lg bg-[#1C1F24] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-[#1C1F24] border border-[#2A2D35] text-white text-sm focus:outline-none focus:border-[#3A89FF] transition-colors"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2.5 rounded-lg bg-[#3A89FF] text-white text-sm font-medium hover:bg-[#3A89FF]/90 disabled:opacity-50 transition-colors"
          >
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </form>
        {inviteError && (
          <p className="text-[#F87171] text-sm">{inviteError}</p>
        )}
        {inviteSuccess && (
          <p className="text-[#4ADE80] text-sm">Member added successfully.</p>
        )}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-[#8B8F97] text-sm">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="text-[#8B8F97] text-sm">No members found.</p>
        ) : (
          members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[#131619] border border-[#2A2D35]"
            >
              <div className="w-9 h-9 rounded-full bg-[#3A89FF]/20 flex items-center justify-center text-[#3A89FF] text-sm font-bold flex-shrink-0">
                {getInitials(m.profiles?.full_name, m.profiles?.email)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">
                  {m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}
                </p>
                {m.profiles?.full_name && (
                  <p className="text-[#8B8F97] text-xs truncate">{m.profiles.email}</p>
                )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                  ROLE_COLORS[m.role] ?? ROLE_COLORS.member
                }`}
              >
                {m.role}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConnectorsView } from "@/components/cleverbrain/cleverbrain-client";
import { signOut } from "@/lib/auth";
import { useWorkspace } from "@/context/workspace-context";

export function ConnectorsPageClient({
  workspaceId,
  userName,
  companyName,
}: {
  workspaceId: string;
  userName: string;
  companyName: string;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <ConnectorsView
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        userName={userName}
        companyName={companyName}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        onSignOut={() => signOut()}
        workspaceId={workspaceId}
      />

      {/* Right Icon Bar */}
      <ConnectorsRightIconBar />
    </div>
  );
}

function ConnectorsRightIconBar() {
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
    <div className="w-[76px] border-l border-[#2A2D35]/60 flex flex-col items-center justify-between py-6 flex-shrink-0 relative bg-[#001022]">
      <div />

      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#2A2D35]/60 px-3 py-5" style={{ background: "#1F1F1FCC" }}>
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png" alt="CleverBrain" width={36} height={36} />
        </Link>
        <Link href="/skyler" title="Skyler" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/skyler-icon.png" alt="Skyler" width={36} height={36} className="rounded-full" />
        </Link>
        <Link href="/connectors" title="Connectors" className="opacity-100 ring-2 ring-[#3A89FF]/40 rounded-lg transition-opacity">
          <Image src="/cleverbrain-chat-icons/conectors-icon.png" alt="Connectors" width={34} height={34} />
        </Link>
        <Link href="/cleverbrain/hireaiemployee" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/hire-ai-employee-icon.png" alt="AI Employees" width={34} height={34} />
        </Link>
        <Link href="/settings" title="Settings" className="opacity-70 hover:opacity-100 transition-opacity">
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

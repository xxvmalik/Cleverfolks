"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ConnectorsView } from "@/components/cleverbrain/cleverbrain-client";
import { signOut } from "@/lib/auth";

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
    <div className="flex h-full">
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
      <div className="w-[76px] border-l border-[#2A2D35]/60 flex flex-col items-center justify-center flex-shrink-0 bg-[#001022]">
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
          <Link href="/settings" title="Organization" className="hover:opacity-80 transition-opacity">
            <Image src="/cleverbrain-chat-icons/organization-icon.png" alt="Organization" width={36} height={36} />
          </Link>
        </div>
      </div>
    </div>
  );
}

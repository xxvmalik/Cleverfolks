"use client";

import { useState } from "react";
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
  );
}

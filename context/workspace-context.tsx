"use client";

import { createContext, useContext, useState } from "react";
import type { Workspace } from "@/types";

type WorkspaceContextValue = {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  setCurrentWorkspace: (w: Workspace) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspaces: initialWorkspaces,
  children,
}: {
  workspaces: Workspace[];
  children: React.ReactNode;
}) {
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    initialWorkspaces[0] ?? null
  );
  const [workspaces] = useState<Workspace[]>(initialWorkspaces);

  return (
    <WorkspaceContext.Provider
      value={{ currentWorkspace, workspaces, setCurrentWorkspace }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

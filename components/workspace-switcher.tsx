"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Check, Plus } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { currentWorkspace, workspaces, setCurrentWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!currentWorkspace) return null;

  const initials = currentWorkspace.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-[#1C1F24] transition-colors text-left",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? currentWorkspace.name : undefined}
      >
        <div className="w-7 h-7 rounded-md bg-[#3A89FF] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {initials}
        </div>
        {!collapsed && (
          <>
            <span className="flex-1 text-white text-sm font-medium truncate">
              {currentWorkspace.name}
            </span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-[#8B8F97] transition-transform flex-shrink-0",
                open && "rotate-180"
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 py-1 bg-[#1C1F24] border border-[#2A2D35] rounded-xl shadow-xl min-w-[200px]",
            collapsed ? "left-full ml-2 top-0" : "left-0 right-0"
          )}
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { setCurrentWorkspace(ws); setOpen(false); }}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm hover:bg-[#2A2D35] transition-colors"
            >
              <div className="w-6 h-6 rounded-md bg-[#3A89FF]/20 flex items-center justify-center text-[#3A89FF] text-xs font-bold flex-shrink-0">
                {ws.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="flex-1 text-white truncate">{ws.name}</span>
              {ws.id === currentWorkspace.id && (
                <Check className="w-3.5 h-3.5 text-[#3A89FF] flex-shrink-0" />
              )}
            </button>
          ))}
          <div className="border-t border-[#2A2D35] mt-1 pt-1">
            <Link
              href="/create-workspace"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-[#8B8F97] hover:bg-[#2A2D35] hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create new workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

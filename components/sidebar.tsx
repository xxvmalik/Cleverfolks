"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Brain,
  Bot,
  Plug,
  Store,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import { WorkspaceSwitcher } from "./workspace-switcher";

const navItems = [
  { label: "Home", href: "/", icon: Home },
  { label: "CleverBrain", href: "/cleverbrain", icon: Brain },
  { label: "SKYLER", href: "/skyler", icon: Bot },
  { label: "Integrations", href: "/integrations", icon: Plug },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen bg-[#131619] border-r border-[#2A2D35] transition-all duration-300 ease-in-out flex-shrink-0",
        collapsed ? "w-[64px]" : "w-[260px]"
      )}
    >
      {/* Workspace Switcher */}
      <div className="h-16 flex items-center px-2 border-b border-[#2A2D35]">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150",
                    isActive
                      ? "bg-[#3A89FF]/15 text-[#3A89FF]"
                      : "text-[#8B8F97] hover:bg-[#1C1F24] hover:text-white"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    className={cn(
                      "flex-shrink-0",
                      collapsed ? "w-5 h-5 mx-auto" : "w-5 h-5"
                    )}
                  />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Sign Out */}
      <div className="border-t border-[#2A2D35] p-2">
        <button
          onClick={handleSignOut}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-[#8B8F97] hover:bg-[#1C1F24] hover:text-[#F87171] transition-colors duration-150",
            collapsed && "justify-center"
          )}
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] flex items-center justify-center w-6 h-6 rounded-full bg-[#1C1F24] border border-[#2A2D35] text-[#8B8F97] hover:text-white hover:bg-[#2A2D35] transition-colors z-10"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>
    </aside>
  );
}

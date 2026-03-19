"use client";

import { useRef, useEffect, useState } from "react";
import { Mail, Calendar, List } from "lucide-react";

export type DetailTab = "activity" | "meetings" | "instructions";

const TABS: { id: DetailTab; label: string; icon: typeof Mail }[] = [
  { id: "activity", label: "Activity", icon: Mail },
  { id: "meetings", label: "Meetings", icon: Calendar },
  { id: "instructions", label: "Instructions", icon: List },
];

export function TabBar({
  activeTab,
  onTabChange,
  meetingCount,
  instructionCount,
}: {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  meetingCount?: number;
  instructionCount?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement | null;
    if (activeEl) {
      setIndicator({ left: activeEl.offsetLeft, width: activeEl.offsetWidth });
    }
  }, [activeTab]);

  const getCounts = (id: DetailTab): number | undefined => {
    if (id === "meetings") return meetingCount;
    if (id === "instructions") return instructionCount;
    return undefined;
  };

  return (
    <div
      ref={containerRef}
      className="relative flex"
      style={{ borderBottom: "1px solid var(--sk-border)", marginTop: 24 }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        const Icon = tab.icon;
        const count = getCounts(tab.id);
        return (
          <button
            key={tab.id}
            data-tab={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex items-center gap-1.5"
            style={{
              padding: "10px 18px",
              fontSize: 11,
              fontWeight: 600,
              color: active ? "var(--sk-t1)" : "var(--sk-t3)",
              borderBottom: "2px solid transparent",
              transition: "color 0.15s",
            }}
          >
            <Icon size={13} style={{ color: active ? "var(--sk-orange)" : "var(--sk-t4)" }} />
            {tab.label}
            {count !== undefined && count > 0 && (
              <span
                style={{
                  fontSize: 9,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: active ? "rgba(242,144,61,0.1)" : "rgba(255,255,255,0.04)",
                  color: active ? "var(--sk-orange)" : "var(--sk-t4)",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
      {/* Sliding indicator */}
      <div
        style={{
          position: "absolute",
          bottom: -1,
          left: indicator.left,
          width: indicator.width,
          height: 2,
          background: "var(--sk-orange)",
          transition: "left 0.25s var(--sk-ease-out), width 0.25s var(--sk-ease-out)",
        }}
      />
    </div>
  );
}

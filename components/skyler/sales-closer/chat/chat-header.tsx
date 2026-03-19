"use client";

import { Zap, X } from "lucide-react";

export type ChatTab = "chat" | "history";

export function ChatHeader({
  activeTab,
  onTabChange,
  onClose,
}: {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--sk-border)" }}
    >
      {/* Left: avatar + tabs */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(135deg, var(--sk-orange), #E8752B)",
          }}
        >
          <Zap size={14} color="#fff" />
        </div>

        <div className="flex items-center gap-1" style={{ position: "relative" }}>
          {(["chat", "history"] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--sk-t1)" : "var(--sk-t3)",
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                  transition: "all 0.2s",
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: close */}
      <button
        onClick={onClose}
        style={{ opacity: 0.3, padding: 4 }}
        className="hover:opacity-60 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  );
}

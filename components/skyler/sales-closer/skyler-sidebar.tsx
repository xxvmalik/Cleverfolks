"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  PanelLeftClose,
  ChevronDown,
  ChevronUp,
  Zap,
  Target,
  Settings,
  Activity,
  Star,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ConversationItem } from "./types";

type WorkflowTab = "lead-qualification" | "sales-closer" | "workflows-settings" | "activity";

const WORKFLOW_TABS: { id: WorkflowTab; label: string; icon: typeof Zap }[] = [
  { id: "lead-qualification", label: "Lead Qualification", icon: Zap },
  { id: "sales-closer", label: "Sales Closer", icon: Target },
  { id: "workflows-settings", label: "Workflows Settings", icon: Settings },
  { id: "activity", label: "Skyler Activity", icon: Activity },
];

export { type WorkflowTab };

export function SkylerSidebar({
  collapsed,
  onCollapse,
  conversations,
  activeConversationId,
  activeTab,
  onTabChange,
  onNewChat,
  onSelectConversation,
  onStarConversation,
  onRenameConversation,
  onDeleteConversation,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  activeTab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onStarConversation: (id: string, starred: boolean) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}) {
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  const starredConvs = conversations.filter((c) => c.is_starred);
  const unstarredConvs = conversations.filter((c) => !c.is_starred);

  if (collapsed) return null;

  return (
    <aside
      className="flex flex-col flex-shrink-0 overflow-hidden"
      style={{
        width: 240,
        background: "var(--sk-bg)",
        borderRight: "1px solid var(--sk-border)",
        animation: "sk-contentIn 0.25s var(--sk-ease-out)",
      }}
    >
      {/* Collapse button */}
      <div className="flex items-center justify-end px-3 pt-3 pb-1">
        <button
          onClick={onCollapse}
          className="transition-colors"
          style={{ color: "var(--sk-t3)" }}
        >
          <PanelLeftClose className="w-5 h-5" />
        </button>
      </div>

      {/* Avatar + New Chat */}
      <div className="flex flex-col items-center px-4 pt-2 pb-4">
        <div className="w-[140px] h-[140px] rounded-full overflow-hidden mb-3">
          <Image
            src="/skyler-icons/skyler-avatar.png"
            alt="Skyler"
            width={140}
            height={140}
            className="object-cover aspect-square"
          />
        </div>
        <h2 style={{ color: "var(--sk-t1)", fontSize: 18, fontWeight: 700 }}>Skyler</h2>
        <p style={{ color: "var(--sk-t3)", fontSize: 13, marginTop: 2 }}>Sales Representative</p>

        <button
          onClick={onNewChat}
          className="mt-4 w-full h-[38px] rounded-full flex items-center justify-center gap-2 text-sm font-medium transition-colors"
          style={{
            color: "var(--sk-t1)",
            background: "var(--sk-card)",
            border: "1px solid var(--sk-border)",
          }}
        >
          <span className="text-lg leading-none">+</span>
          Start new chat
        </button>
      </div>

      {/* Workflow nav */}
      <nav className="px-2 space-y-0.5">
        {WORKFLOW_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
              style={{
                color: isActive ? "var(--sk-t1)" : "var(--sk-t3)",
                background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
                borderLeft: isActive ? "2px solid var(--sk-orange)" : "2px solid transparent",
              }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* History */}
      <div className="flex-1 flex flex-col overflow-hidden mt-4">
        <button
          onClick={() => setHistoryCollapsed((v) => !v)}
          className="flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors"
          style={{ color: "var(--sk-t1)" }}
        >
          <span>History</span>
          {historyCollapsed ? (
            <ChevronDown className="w-4 h-4" style={{ color: "var(--sk-t3)" }} />
          ) : (
            <ChevronUp className="w-4 h-4" style={{ color: "var(--sk-t3)" }} />
          )}
        </button>

        {!historyCollapsed && (
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {/* Starred */}
            {starredConvs.length > 0 && (
              <div className="mb-2">
                <div
                  className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
                  style={{ color: "rgba(251,176,64,0.7)" }}
                >
                  <Star className="w-2.5 h-2.5 fill-[#FBB040] text-[#FBB040]" />
                  Starred
                </div>
                <div className="space-y-0.5">
                  {starredConvs.map((conv) => (
                    <ConvItem
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === activeConversationId}
                      onClick={() => onSelectConversation(conv.id)}
                      onStar={onStarConversation}
                      onRename={onRenameConversation}
                      onDelete={onDeleteConversation}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unstarred */}
            {unstarredConvs.length > 0 && (
              <div className="space-y-0.5">
                {unstarredConvs.map((conv) => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeConversationId}
                    onClick={() => onSelectConversation(conv.id)}
                    onStar={onStarConversation}
                    onRename={onRenameConversation}
                    onDelete={onDeleteConversation}
                  />
                ))}
              </div>
            )}

            {conversations.length === 0 && (
              <p className="px-3 py-4 text-xs text-center" style={{ color: "var(--sk-t4)" }}>
                No conversations yet
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Conversation Item ─────────────────────────────────────────────────────────

function ConvItem({
  conv,
  isActive,
  onClick,
  onStar,
  onRename,
  onDelete,
}: {
  conv: ConversationItem;
  isActive: boolean;
  onClick: () => void;
  onStar: (id: string, starred: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.custom_title ?? conv.title ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (renaming) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(conv.id, renameValue); setRenaming(false); }
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={() => { onRename(conv.id, renameValue); setRenaming(false); }}
          className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
          style={{
            background: "var(--sk-card)",
            border: "1px solid var(--sk-blue)",
            color: "var(--sk-t1)",
          }}
        />
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="px-2 py-1.5 rounded-lg mx-1" style={{ background: "rgba(229,69,69,0.1)", border: "1px solid rgba(229,69,69,0.3)" }}>
        <p className="text-xs mb-2" style={{ color: "var(--sk-red)" }}>Delete this conversation?</p>
        <div className="flex gap-2">
          <button
            onClick={() => { onDelete(conv.id); setConfirmDelete(false); }}
            className="px-2 py-1 rounded text-xs"
            style={{ background: "rgba(229,69,69,0.2)", color: "var(--sk-red)" }}
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-1 rounded text-xs"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--sk-t3)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const displayTitle = conv.custom_title || conv.title || "New conversation";

  return (
    <div className="group relative flex items-center">
      <button
        onClick={onClick}
        className="w-full text-left px-3 py-2 rounded-lg text-xs truncate transition-colors duration-150 flex items-center gap-1.5"
        style={{
          background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
          color: isActive ? "var(--sk-t1)" : "var(--sk-t3)",
        }}
      >
        {conv.is_starred && <Star className="w-3 h-3 text-[#FBB040] fill-[#FBB040] flex-shrink-0" />}
        <span className="truncate">{displayTitle}</span>
      </button>

      <div ref={menuRef} className="absolute right-1 top-1/2 -translate-y-1/2">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-opacity"
        >
          <MoreHorizontal className="w-3.5 h-3.5" style={{ color: "var(--sk-t3)" }} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 rounded-lg shadow-xl py-1 z-50 w-36"
            style={{ background: "var(--sk-card)", border: "1px solid var(--sk-border)" }}
          >
            <button
              onClick={() => { onStar(conv.id, !conv.is_starred); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 flex items-center gap-2"
              style={{ color: "var(--sk-t2)" }}
            >
              <Star className={`w-3 h-3 ${conv.is_starred ? "text-[#FBB040] fill-[#FBB040]" : ""}`} style={{ color: conv.is_starred ? undefined : "var(--sk-t3)" }} />
              {conv.is_starred ? "Unstar" : "Star"}
            </button>
            <button
              onClick={() => { setRenaming(true); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 flex items-center gap-2"
              style={{ color: "var(--sk-t2)" }}
            >
              <Pencil className="w-3 h-3" style={{ color: "var(--sk-t3)" }} />
              Rename
            </button>
            <button
              onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 flex items-center gap-2"
              style={{ color: "var(--sk-red)" }}
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

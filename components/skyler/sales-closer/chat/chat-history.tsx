"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { ConversationItem } from "../types";

export function ChatHistory({
  conversations,
  onSelectConversation,
}: {
  conversations: ConversationItem[];
  onSelectConversation: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);

  // Extract unique lead names for filter pills
  const leadNames = Array.from(
    new Set(conversations.filter((c) => c.lead_name).map((c) => c.lead_name!))
  );

  const filtered = filter
    ? conversations.filter((c) => c.lead_name === filter)
    : conversations;

  // Group by date
  const grouped = groupByDate(filtered);

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <MessageSquare size={20} style={{ color: "var(--sk-t4)", marginBottom: 8 }} />
        <p style={{ fontSize: 11, color: "var(--sk-t4)", textAlign: "center" }}>
          No conversation history yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Lead filter pills */}
      {leadNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2" style={{ borderBottom: "1px solid var(--sk-border)" }}>
          <button
            onClick={() => setFilter(null)}
            style={{
              fontSize: 9,
              padding: "3px 8px",
              borderRadius: 10,
              background: !filter ? "rgba(242,144,61,0.12)" : "rgba(255,255,255,0.04)",
              color: !filter ? "var(--sk-orange)" : "var(--sk-t3)",
              border: "1px solid",
              borderColor: !filter ? "rgba(242,144,61,0.15)" : "transparent",
              fontWeight: 500,
            }}
          >
            All
          </button>
          {leadNames.map((name) => (
            <button
              key={name}
              onClick={() => setFilter(name)}
              style={{
                fontSize: 9,
                padding: "3px 8px",
                borderRadius: 10,
                background: filter === name ? "rgba(242,144,61,0.12)" : "rgba(255,255,255,0.04)",
                color: filter === name ? "var(--sk-orange)" : "var(--sk-t3)",
                border: "1px solid",
                borderColor: filter === name ? "rgba(242,144,61,0.15)" : "transparent",
                fontWeight: 500,
              }}
            >
              {name.split(/\s+/)[0]}
            </button>
          ))}
        </div>
      )}

      {/* Date-grouped threads */}
      <div className="px-3 py-2">
        {grouped.map(({ label, items }) => (
          <div key={label} className="mb-3">
            <p style={{ fontSize: 9, color: "var(--sk-t4)", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {label}
            </p>
            <div className="flex flex-col gap-1">
              {items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className="text-left hover:bg-white/[0.02] transition-colors"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid transparent",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11, color: "var(--sk-t2)", fontWeight: 500 }}>
                      {conv.title || "Untitled conversation"}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--sk-t4)" }}>
                      {formatTime(conv.updated_at)}
                    </span>
                  </div>
                  {conv.lead_name && (
                    <span style={{ fontSize: 9, color: "var(--sk-orange)", opacity: 0.6, marginTop: 2, display: "block" }}>
                      @{conv.lead_name}
                    </span>
                  )}
                  {conv.preview && (
                    <p style={{ fontSize: 10, color: "var(--sk-t4)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {conv.preview}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByDate(items: ConversationItem[]): { label: string; items: ConversationItem[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: Record<string, ConversationItem[]> = {};

  for (const item of items) {
    const d = new Date(item.updated_at);
    let label: string;
    if (d >= today) label = "Today";
    else if (d >= yesterday) label = "Yesterday";
    else if (d >= weekAgo) label = "This Week";
    else label = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

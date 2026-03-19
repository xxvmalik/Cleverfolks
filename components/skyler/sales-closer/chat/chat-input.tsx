"use client";

import { useRef, useCallback } from "react";
import { Send, X } from "lucide-react";
import { HealthDot } from "../shared/health-dot";
import type { TaggedLead } from "../types";

export function ChatInput({
  value,
  onChange,
  onSend,
  taggedLead,
  onClearTag,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  taggedLead: TaggedLead | null;
  onClearTag: () => void;
  disabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSend();
    }
  };

  const firstName = taggedLead?.name.split(/\s+/)[0];

  return (
    <div style={{ padding: "8px 10px", borderTop: "1px solid var(--sk-border)" }}>
      {/* Tagged lead context bar */}
      {taggedLead && (
        <div
          className="flex items-center justify-between mb-2"
          style={{
            background: "rgba(242,144,61,0.03)",
            border: "1px solid rgba(242,144,61,0.06)",
            borderRadius: 8,
            padding: "7px 10px",
          }}
        >
          <div className="flex items-center gap-1.5">
            <HealthDot score={taggedLead.healthScore ?? null} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sk-t1)" }}>{taggedLead.name}</span>
            <span style={{ fontSize: 9, color: "var(--sk-t3)" }}>{taggedLead.company}</span>
          </div>
          <button onClick={onClearTag} style={{ opacity: 0.3 }} className="hover:opacity-60">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div
        className="flex items-end gap-2"
        style={{
          background: "var(--sk-card)",
          border: "1px solid var(--sk-border)",
          borderRadius: 8,
          padding: "9px 12px",
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); resize(); }}
          onKeyDown={handleKeyDown}
          placeholder={taggedLead ? `Ask about ${firstName}...` : "Message Skyler..."}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: 11,
            color: "var(--sk-t1)",
            lineHeight: 1.5,
            maxHeight: 120,
          }}
        />
        <button
          onClick={() => { if (value.trim()) onSend(); }}
          style={{ opacity: value.trim() ? 1 : 0.2, transition: "opacity 0.15s" }}
        >
          <Send size={14} style={{ color: "var(--sk-orange)" }} />
        </button>
      </div>
    </div>
  );
}

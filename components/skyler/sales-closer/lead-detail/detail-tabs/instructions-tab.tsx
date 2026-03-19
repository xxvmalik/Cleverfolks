"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import type { DirectiveItem } from "../../types";

export function InstructionsTab({
  directives,
  loading,
  onAdd,
  onRemove,
}: {
  directives: DirectiveItem[];
  loading: boolean;
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}) {
  const [newText, setNewText] = useState("");

  if (loading) {
    return <div className="py-8 text-center" style={{ fontSize: 11, color: "var(--sk-t4)" }}>Loading...</div>;
  }

  return (
    <div className="mt-4">
      <p style={{ fontSize: 11, color: "var(--sk-t3)", lineHeight: 1.5, marginBottom: 16 }}>
        Instructions you&apos;ve given Skyler for this lead.
      </p>

      <div className="flex flex-col" style={{ gap: 6 }}>
        {directives.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-2"
            style={{
              background: "var(--sk-card-lead)",
              border: "1px solid var(--sk-border)",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <span className="flex-1" style={{ fontSize: 11, color: "var(--sk-t2)" }}>{d.directive_text}</span>
            <span style={{ fontSize: 9, color: "var(--sk-t4)", whiteSpace: "nowrap" }}>
              Added {new Date(d.created_at).toLocaleDateString("en-GB", { month: "short", day: "numeric" })}
            </span>
            <button onClick={() => onRemove(d.id)} style={{ opacity: 0.25 }} className="hover:opacity-60 transition-opacity">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Add input */}
      <div className="flex gap-2 mt-3">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add instruction..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && newText.trim()) {
              onAdd(newText.trim());
              setNewText("");
            }
          }}
          style={{
            flex: 1,
            background: "var(--sk-card)",
            border: "1px solid var(--sk-border)",
            borderRadius: 7,
            padding: "8px 12px",
            fontSize: 11,
            color: "var(--sk-t1)",
            outline: "none",
          }}
        />
        <button
          onClick={() => {
            if (newText.trim()) {
              onAdd(newText.trim());
              setNewText("");
            }
          }}
          style={{
            background: "var(--sk-card)",
            border: "1px solid var(--sk-border)",
            color: "var(--sk-t3)",
            borderRadius: 7,
            padding: "8px 12px",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

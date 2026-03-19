"use client";

import { Zap } from "lucide-react";

export function ChatEmpty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div
        className="flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "linear-gradient(135deg, var(--sk-orange), #E8752B)",
          opacity: 0.45,
        }}
      >
        <Zap size={22} color="#fff" />
      </div>
      <p style={{ fontSize: 11, color: "var(--sk-t3)", marginTop: 12, textAlign: "center" }}>
        Ask Skyler about outreach, pipeline, or performance.
      </p>
      <p style={{ fontSize: 10, color: "var(--sk-t4)", marginTop: 4 }}>
        Use <span style={{ color: "var(--sk-orange)" }}>@</span> to tag a lead.
      </p>
    </div>
  );
}

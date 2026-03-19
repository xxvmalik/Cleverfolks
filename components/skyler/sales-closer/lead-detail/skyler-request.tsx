"use client";

import { MessageCircle } from "lucide-react";

export function SkylerRequest({
  text,
  onReply,
  onDismiss,
}: {
  text: string;
  onReply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        background: "rgba(242,144,61,0.03)",
        border: "1px solid rgba(242,144,61,0.09)",
        borderRadius: 10,
        padding: "14px 16px",
        marginTop: 14,
      }}
    >
      <div className="flex items-start gap-2.5">
        {/* Skyler avatar */}
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "linear-gradient(135deg, var(--sk-orange), #E8752B)",
          }}
        >
          <MessageCircle size={13} color="#fff" />
        </div>
        <div className="flex-1">
          <p style={{
            fontSize: 9,
            fontWeight: 700,
            color: "var(--sk-orange)",
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            SKYLER NEEDS YOUR INPUT
          </p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>{text}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onReply}
          style={{
            background: "var(--sk-orange)",
            color: "#fff",
            borderRadius: 7,
            padding: "7px 16px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Reply to Skyler
        </button>
        <button
          onClick={onDismiss}
          style={{
            background: "var(--sk-card)",
            border: "1px solid var(--sk-border)",
            color: "var(--sk-t3)",
            borderRadius: 7,
            padding: "7px 16px",
            fontSize: 11,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

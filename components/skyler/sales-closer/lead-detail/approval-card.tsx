"use client";

import { useState } from "react";
import { Mail, ChevronRight, ChevronDown, Check, Pencil, X } from "lucide-react";
import type { PendingAction } from "../types";

function timeAgo(ts: string): string {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

export function ApprovalCard({
  action,
  onApprove,
  onReject,
}: {
  action: PendingAction;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string, feedback: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(action.tool_input?.body ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [sending, setSending] = useState(false);

  const subject = action.tool_input?.subject ?? action.description;
  const body = editing ? editBody : (action.tool_input?.body ?? "");

  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid rgba(242,144,61,0.06)",
        borderRadius: 10,
      }}
    >
      {/* Collapsed header */}
      <button
        onClick={() => { setExpanded(!expanded); setRejecting(false); }}
        className="w-full flex items-center gap-2 text-left"
        style={{ padding: "10px 14px" }}
      >
        <Mail size={13} style={{ color: "var(--sk-orange)", flexShrink: 0 }} />
        <span className="flex-1 truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--sk-t1)" }}>
          {subject}
        </span>
        <span style={{ fontSize: 10, color: "var(--sk-t4)", whiteSpace: "nowrap" }}>
          {timeAgo(action.created_at)}
        </span>
        {expanded ? <ChevronDown size={13} style={{ color: "var(--sk-t4)" }} /> : <ChevronRight size={13} style={{ color: "var(--sk-t4)" }} />}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          {editing ? (
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              style={{
                width: "100%",
                minHeight: 160,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--sk-border)",
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: 11,
                color: "var(--sk-t2)",
                lineHeight: 1.7,
                resize: "vertical",
                outline: "none",
              }}
            />
          ) : (
            <div
              style={{
                background: "rgba(0,0,0,0.25)",
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: 11,
                color: "var(--sk-t2)",
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {body}
            </div>
          )}

          {/* Reject reason input */}
          {rejecting && (
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tell Skyler why..."
              autoFocus
              style={{
                width: "100%",
                marginTop: 8,
                background: "rgba(0,0,0,0.2)",
                border: "1px solid rgba(229,69,69,0.2)",
                borderRadius: 6,
                padding: "7px 10px",
                fontSize: 11,
                color: "var(--sk-t2)",
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && rejectReason.trim()) {
                  onReject(action.id, rejectReason.trim());
                }
              }}
            />
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => {
                setSending(true);
                await onApprove(action.id);
                setSending(false);
              }}
              disabled={sending}
              style={{
                background: "var(--sk-green)",
                color: "#fff",
                borderRadius: 7,
                padding: "7px 16px",
                fontSize: 11,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 4,
                opacity: sending ? 0.5 : 1,
              }}
            >
              <Check size={13} /> {sending ? "Sending..." : "Approve & Send"}
            </button>

            {editing ? (
              <button
                onClick={() => setEditing(false)}
                style={{
                  background: "var(--sk-card)",
                  border: "1px solid var(--sk-border)",
                  color: "var(--sk-t2)",
                  borderRadius: 7,
                  padding: "7px 16px",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Done
              </button>
            ) : (
              <button
                onClick={() => { setEditing(true); setEditBody(action.tool_input?.body ?? ""); }}
                style={{
                  background: "var(--sk-card)",
                  border: "1px solid var(--sk-border)",
                  color: "var(--sk-t2)",
                  borderRadius: 7,
                  padding: "7px 16px",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Pencil size={13} /> Edit
              </button>
            )}

            <button
              onClick={() => {
                if (rejecting && rejectReason.trim()) {
                  onReject(action.id, rejectReason.trim());
                } else {
                  setRejecting(true);
                }
              }}
              style={{
                background: rejecting ? "rgba(229,69,69,0.06)" : "rgba(229,69,69,0.03)",
                border: `1px solid rgba(229,69,69,${rejecting ? "0.15" : "0.07"})`,
                color: "var(--sk-red)",
                borderRadius: 7,
                padding: "7px 16px",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {rejecting ? "Confirm Reject" : <><X size={13} /> Reject</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

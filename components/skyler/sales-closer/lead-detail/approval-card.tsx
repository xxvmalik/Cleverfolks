"use client";

import { useState } from "react";
import { Mail, ChevronRight, ChevronDown, Check, Pencil, X, AlertTriangle, RotateCw } from "lucide-react";
import Image from "next/image";
import type { PendingAction } from "../types";

function timeAgo(ts: string): string {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

/** Strip basic HTML tags for plain-text display in the preview */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

export function ApprovalCard({
  action,
  onApprove,
  onReject,
  onRetry,
}: {
  action: PendingAction;
  onApprove: (actionId: string, editedBody?: string) => void;
  onReject: (actionId: string, feedback: string) => void;
  onRetry?: (actionId: string) => void;
}) {
  // Read the ACTUAL fields the email sender stores
  const originalText =
    action.tool_input?.textBody ??
    (action.tool_input?.htmlBody ? stripHtml(action.tool_input.htmlBody) : "") ??
    action.tool_input?.body ??
    "";

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(originalText);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [sending, setSending] = useState(false);

  const isFailed = action.status === "failed";
  const errorMessage = action.result?.last_error;
  const subject = action.tool_input?.subject ?? action.description;
  const displayBody = editing ? editBody : originalText;
  const wasEdited = editBody !== originalText;

  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: `1px solid ${isFailed ? "rgba(229,69,69,0.2)" : "rgba(242,144,61,0.06)"}`,
        borderRadius: 10,
      }}
    >
      {/* Collapsed header */}
      <button
        onClick={() => { setExpanded(!expanded); setRejecting(false); }}
        className="w-full flex items-center gap-2 text-left"
        style={{ padding: "10px 14px" }}
      >
        {isFailed
          ? <AlertTriangle size={13} style={{ color: "var(--sk-red)", flexShrink: 0 }} />
          : <Mail size={13} style={{ color: "var(--sk-orange)", flexShrink: 0 }} />
        }
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
                border: "1px solid var(--sk-blue)",
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
              {displayBody || <span style={{ color: "var(--sk-t4)", fontStyle: "italic" }}>No email body</span>}
            </div>
          )}

          {/* Error banner for failed sends */}
          {isFailed && (
            <div
              className="flex items-center gap-2"
              style={{
                marginTop: 8,
                padding: "8px 12px",
                background: "rgba(229,69,69,0.08)",
                border: "1px solid rgba(229,69,69,0.15)",
                borderRadius: 8,
              }}
            >
              <AlertTriangle size={13} style={{ color: "var(--sk-red)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--sk-red)", flex: 1 }}>
                Send failed{errorMessage ? `: ${errorMessage}` : ""}
              </span>
              <button
                onClick={async () => {
                  if (onRetry) {
                    setSending(true);
                    await onRetry(action.id);
                    setSending(false);
                  }
                }}
                disabled={sending}
                style={{
                  background: "rgba(229,69,69,0.12)",
                  color: "var(--sk-red)",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  opacity: sending ? 0.5 : 1,
                }}
              >
                <RotateCw size={11} /> {sending ? "Retrying..." : "Retry"}
              </button>
            </div>
          )}

          {/* Reject reason flow — Skyler asks why */}
          {rejecting && (
            <div style={{ marginTop: 8 }}>
              <div className="flex items-start gap-2 mb-2" style={{ padding: "8px 10px", background: "rgba(242,144,61,0.04)", borderRadius: 8 }}>
                <Image src="/skyler-icons/skyler-avatar.png" alt="Skyler" width={20} height={20} className="rounded-full flex-shrink-0 mt-0.5 object-cover" />
                <p style={{ fontSize: 11, color: "var(--sk-t2)", lineHeight: 1.5 }}>
                  Why? Tell me what you don&apos;t like about this so I can redraft it better.
                </p>
              </div>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Too formal, mention the demo we discussed..."
                autoFocus
                style={{
                  width: "100%",
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
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => {
                setSending(true);
                // Pass editedBody only if user actually edited
                await onApprove(action.id, wasEdited ? editBody : undefined);
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
              <Check size={13} /> {sending ? "Sending..." : wasEdited ? "Approve Edited & Send" : "Approve & Send"}
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
                Done Editing
              </button>
            ) : (
              <button
                onClick={() => { setEditing(true); setEditBody(editBody || originalText); }}
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

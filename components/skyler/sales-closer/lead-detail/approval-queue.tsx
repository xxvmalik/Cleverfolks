"use client";

import { SectionDivider } from "../shared/section-divider";
import { ApprovalCard } from "./approval-card";
import type { PendingAction } from "../types";

export function ApprovalQueue({
  actions,
  onApprove,
  onReject,
  onRetry,
}: {
  actions: PendingAction[];
  onApprove: (actionId: string, editedBody?: string) => void;
  onReject: (actionId: string, feedback: string) => void;
  onRetry?: (actionId: string) => void;
}) {
  if (actions.length === 0) return null;

  const failedCount = actions.filter((a) => a.status === "failed").length;

  return (
    <div>
      <SectionDivider label="PENDING APPROVAL" count={actions.length} />
      {failedCount > 0 && (
        <p style={{ fontSize: 10, color: "var(--sk-red)", marginBottom: 4, paddingLeft: 2 }}>
          {failedCount} failed — tap to retry
        </p>
      )}
      <div className="flex flex-col" style={{ gap: 6 }}>
        {actions.map((a) => (
          <ApprovalCard key={a.id} action={a} onApprove={onApprove} onReject={onReject} onRetry={onRetry} />
        ))}
      </div>
    </div>
  );
}

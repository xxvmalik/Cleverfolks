"use client";

import { SectionDivider } from "../shared/section-divider";
import { ApprovalCard } from "./approval-card";
import type { PendingAction } from "../types";

export function ApprovalQueue({
  actions,
  onApprove,
  onReject,
}: {
  actions: PendingAction[];
  onApprove: (actionId: string) => void;
  onReject: (actionId: string, feedback: string) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <div>
      <SectionDivider label="PENDING APPROVAL" count={actions.length} />
      <div className="flex flex-col" style={{ gap: 6 }}>
        {actions.map((a) => (
          <ApprovalCard key={a.id} action={a} onApprove={onApprove} onReject={onReject} />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";

type ActionApprovalProps = {
  actionId: string;
  description: string;
  workspaceId: string;
  onResolved?: (status: "executed" | "rejected") => void;
};

export function ActionApproval({
  actionId,
  description,
  workspaceId,
  onResolved,
}: ActionApprovalProps) {
  const [status, setStatus] = useState<"pending" | "executing" | "executed" | "rejected" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAction(action: "approve" | "reject") {
    setStatus(action === "approve" ? "executing" : "rejected");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/skyler/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, action, workspaceId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }

      const finalStatus = action === "approve" ? "executed" : "rejected";
      setStatus(finalStatus);
      onResolved?.(finalStatus as "executed" | "rejected");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (status === "executed") {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1A2E1A] border border-[#2A4A2A] rounded-xl text-sm">
        <Check className="w-4 h-4 text-[#4ADE80] flex-shrink-0" />
        <span className="text-[#4ADE80]">Executed:</span>
        <span className="text-[#E0E0E0]">{description}</span>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-[#2E1A1A] border border-[#4A2A2A] rounded-xl text-sm">
        <X className="w-4 h-4 text-[#F87171] flex-shrink-0" />
        <span className="text-[#F87171]">Rejected:</span>
        <span className="text-[#8B8F97]">{description}</span>
      </div>
    );
  }

  if (status === "executing") {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1A1A2E] border border-[#2A2A4A] rounded-xl text-sm">
        <Loader2 className="w-4 h-4 text-[#3A89FF] animate-spin flex-shrink-0" />
        <span className="text-[#3A89FF]">Executing...</span>
        <span className="text-[#E0E0E0]">{description}</span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-[#1F1D1A] border border-[#F2903D]/30 rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[#F2903D] text-xs font-medium mb-1">Action requires approval</p>
          <p className="text-[#E0E0E0] text-sm">{description}</p>
          {status === "error" && errorMsg && (
            <p className="text-[#F87171] text-xs mt-1">Error: {errorMsg}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => handleAction("approve")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4ADE80]/15 hover:bg-[#4ADE80]/25 border border-[#4ADE80]/30 rounded-lg text-[#4ADE80] text-xs font-medium transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            onClick={() => handleAction("reject")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F87171]/15 hover:bg-[#F87171]/25 border border-[#F87171]/30 rounded-lg text-[#F87171] text-xs font-medium transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

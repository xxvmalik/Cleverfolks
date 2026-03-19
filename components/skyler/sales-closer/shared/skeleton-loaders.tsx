"use client";

function Bone({ w, h = 12 }: { w: string | number; h?: number }) {
  return <div className="sk-skeleton" style={{ width: w, height: h, flexShrink: 0 }} />;
}

export function LeadCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Bone w={5} h={5} />
        <Bone w="60%" h={14} />
      </div>
      <div className="flex items-center justify-between mb-2">
        <Bone w="40%" h={10} />
        <Bone w={60} h={18} />
      </div>
      <Bone w="70%" h={9} />
    </div>
  );
}

export function DetailHeaderSkeleton() {
  return (
    <div style={{ padding: "14px 22px 12px", background: "var(--sk-surface)", borderBottom: "1px solid var(--sk-border)" }}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Bone w={200} h={20} />
          <Bone w={160} h={12} />
        </div>
        <div className="flex items-center gap-4">
          <Bone w={32} h={32} />
          <Bone w={80} h={24} />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Bone w={60} h={20} />
        <Bone w={80} h={20} />
      </div>
    </div>
  );
}

export function EmailCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--sk-card-lead)",
        border: "1px solid var(--sk-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bone w={36} h={18} />
          <Bone w={100} h={12} />
        </div>
        <Bone w={80} h={10} />
      </div>
      <div className="space-y-2">
        <Bone w="100%" h={12} />
        <Bone w="80%" h={12} />
        <Bone w="60%" h={12} />
      </div>
    </div>
  );
}

export function ChatBubbleSkeleton({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div className="sk-skeleton" style={{ width: "65%", height: 48, borderRadius: 12 }} />
    </div>
  );
}

"use client";

export function SectionDivider({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 20, marginBottom: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--sk-t3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontSize: 9,
            color: "var(--sk-t4)",
            background: "rgba(255,255,255,0.04)",
            borderRadius: 999,
            padding: "1px 7px",
          }}
        >
          {count}
        </span>
      )}
      <div className="flex-1" style={{ height: 1, background: "var(--sk-border)" }} />
    </div>
  );
}

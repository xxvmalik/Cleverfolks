"use client";

export function HealthDot({ score }: { score: number | null }) {
  let color = "rgba(255,255,255,0.18)";
  if (score !== null) {
    if (score >= 70) color = "var(--sk-green)";
    else if (score >= 50) color = "var(--sk-orange)";
    else color = "var(--sk-red)";
  }

  return (
    <span
      className="inline-block shrink-0"
      style={{ width: 5, height: 5, borderRadius: "50%", background: color, opacity: 0.7 }}
    />
  );
}

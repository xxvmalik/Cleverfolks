"use client";

export function HealthCircle({ score }: { score: number | null }) {
  if (score === null) return null;

  let color = "var(--sk-orange)";
  if (score >= 70) color = "var(--sk-green)";
  else if (score < 50) color = "var(--sk-red)";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: `color-mix(in srgb, ${color} 9%, transparent)`,
          border: `2px solid color-mix(in srgb, ${color} 27%, transparent)`,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color }}>{score}</span>
      </div>
      <span style={{ fontSize: 9, color: "var(--sk-t4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        HEALTH
      </span>
    </div>
  );
}

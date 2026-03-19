"use client";

import Image from "next/image";

export function ChatEmpty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          overflow: "hidden",
          opacity: 0.45,
        }}
      >
        <Image
          src="/skyler-icons/skyler-avatar.png"
          alt="Skyler"
          width={44}
          height={44}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <p style={{ fontSize: 11, color: "var(--sk-t3)", marginTop: 12, textAlign: "center" }}>
        Ask Skyler about outreach, pipeline, or performance.
      </p>
      <p style={{ fontSize: 10, color: "var(--sk-t4)", marginTop: 4 }}>
        Use <span style={{ color: "var(--sk-orange)" }}>@</span> to tag a lead.
      </p>
    </div>
  );
}

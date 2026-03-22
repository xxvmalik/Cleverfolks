"use client";

import Image from "next/image";
import Link from "next/link";

export function RightIconBar() {
  return (
    <div
      className="flex flex-col items-center justify-center flex-shrink-0"
      style={{
        width: 76,
        background: "var(--sk-bg)",
        borderLeft: "1px solid var(--sk-border)",
      }}
    >
      <div
        className="flex flex-col items-center gap-6 rounded-2xl px-3 py-5"
        style={{
          border: "1px solid var(--sk-border)",
          background: "rgba(31,31,31,0.8)",
        }}
      >
        <Link href="/cleverbrain" title="CleverBrain" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/cleverbrain-chat-icon.png" alt="CleverBrain" width={36} height={36} />
        </Link>
        <Link href="/skyler" title="Skyler" className="opacity-100 ring-2 ring-[#F2903D]/40 rounded-lg transition-opacity">
          <Image src="/cleverbrain-chat-icons/skyler-icon.png" alt="Skyler" width={36} height={36} className="rounded-full" />
        </Link>
        <Link href="/connectors" title="Connectors" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/conectors-icon.png" alt="Connectors" width={34} height={34} />
        </Link>
        <Link href="/cleverbrain/hireaiemployee" title="AI Employees" className="opacity-70 hover:opacity-100 transition-opacity">
          <Image src="/cleverbrain-chat-icons/hire-ai-employee-icon.png" alt="AI Employees" width={34} height={34} />
        </Link>
        <Link href="/connectors" title="Organization" className="hover:opacity-80 transition-opacity">
          <Image src="/cleverbrain-chat-icons/organization-icon.png" alt="Organization" width={36} height={36} />
        </Link>
      </div>
    </div>
  );
}

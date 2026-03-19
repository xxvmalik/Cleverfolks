"use client";

import { useRouter } from "next/navigation";
import { MarketplacePanel } from "@/components/cleverbrain/cleverbrain-client";

export default function HireAIEmployeePage() {
  const router = useRouter();

  return (
    <div className="flex h-full items-center justify-center bg-[#151515]">
      <MarketplacePanel onClose={() => router.back()} />
    </div>
  );
}

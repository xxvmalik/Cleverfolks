"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";

export function OrgSuccessScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push("/onboarding?step=8"), 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-[#4ADE80]/15 flex items-center justify-center animate-scale-in">
          <CheckCircle className="w-12 h-12 text-[#4ADE80] animate-pulse" />
        </div>
        <div className="absolute inset-0 rounded-full bg-[#4ADE80]/10 animate-ping" />
      </div>
      <div className="space-y-2">
        <h2 className="font-heading font-bold text-3xl text-white">Workspace Ready!</h2>
        <p className="text-[#8B8F97] text-lg max-w-sm">
          Your company profile is set up. Now let&apos;s configure SKYLER, your AI sales assistant.
        </p>
      </div>
      <p className="text-[#8B8F97] text-sm">Continuing in a moment…</p>
    </div>
  );
}

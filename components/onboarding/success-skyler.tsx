"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

export function SkylerSuccessScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push("/"), 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-[#7C3AED]/15 flex items-center justify-center">
          <Zap className="w-12 h-12 text-[#7C3AED] animate-pulse" />
        </div>
        <div className="absolute inset-0 rounded-full bg-[#7C3AED]/10 animate-ping" />
      </div>
      <div className="space-y-2">
        <h2 className="font-heading font-bold text-3xl text-white">SKYLER Activated!</h2>
        <p className="text-[#8B8F97] text-lg max-w-sm">
          Your AI sales assistant is ready. Let&apos;s go build something great.
        </p>
      </div>
      <p className="text-[#8B8F97] text-sm">Taking you to the dashboard…</p>
    </div>
  );
}

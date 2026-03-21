"use client";
import { Check } from "lucide-react";
import * as Icons from "lucide-react";

type Props = {
  name: string;
  description: string;
  icon: string;
  isConnected: boolean;
  isComingSoon: boolean;
  onConnect: () => void;
  accentColor?: string;
};

export function IntegrationCard({ name, description, icon, isConnected, isComingSoon, onConnect, accentColor = "#5B3DC8" }: Props) {
  // Dynamic icon lookup - fallback to Plug
  const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    icon.charAt(0).toUpperCase() + icon.slice(1)
  ] ?? Icons.Plug;

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
      isConnected ? "border-[#4ADE80]/30 bg-[#4ADE80]/5" : "border-[#2A2D35] bg-[#1C1F24]"
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#2A2D35] flex items-center justify-center">
          <IconComponent className="w-5 h-5 text-[#8B8F97]" />
        </div>
        <div>
          <div className="text-sm font-medium text-white">{name}</div>
          <div className="text-xs text-[#8B8F97]">{description}</div>
        </div>
      </div>
      {isComingSoon ? (
        <span className="text-xs text-[#8B8F97] px-3 py-1.5 rounded-lg bg-[#2A2D35]">Coming Soon</span>
      ) : isConnected ? (
        <span className="inline-flex items-center gap-1 text-xs text-[#4ADE80] px-3 py-1.5 rounded-lg bg-[#4ADE80]/10">
          <Check className="w-3.5 h-3.5" /> Connected
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
          style={{ backgroundColor: accentColor }}
        >
          Connect
        </button>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import * as Icons from "lucide-react";
import Nango from "@nangohq/frontend";
import type { ConnectUIEvent } from "@nangohq/frontend";
import { connectIntegrationAction } from "@/app/actions/integrations";

type Props = {
  name: string;
  description: string;
  icon: string;
  providerId: string;
  isConnected: boolean;
  isComingSoon: boolean;
  workspaceId: string;
  onConnected?: (providerId: string) => void;
  accentColor?: string;
};

export function IntegrationCard({
  name,
  description,
  icon,
  providerId,
  isConnected,
  isComingSoon,
  workspaceId,
  onConnected,
  accentColor = "#5B3DC8",
}: Props) {
  const [connected, setConnected] = useState(isConnected);
  const [connecting, setConnecting] = useState(false);

  // Dynamic icon lookup - fallback to Plug
  const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    icon.charAt(0).toUpperCase() + icon.slice(1)
  ] ?? Icons.Plug;

  async function handleConnect() {
    // Google Calendar: direct OAuth to force refresh token
    if (providerId === "google-calendar") {
      window.location.href = `/api/skyler/calendar/authorize?workspaceId=${workspaceId}`;
      return;
    }

    setConnecting(true);
    try {
      const tokenRes = await fetch("/api/nango-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!tokenRes.ok) throw new Error("Failed to create Nango session");
      const { token } = (await tokenRes.json()) as { token: string };

      let connectDone = false;
      await new Promise<void>((resolve, reject) => {
        const nango = new Nango({ connectSessionToken: token });
        const connectUI = nango.openConnectUI({
          onEvent: async (event: ConnectUIEvent) => {
            if (event.type === "connect") {
              connectDone = true;
              const { connectionId, providerConfigKey } = event.payload;
              try {
                const result = await connectIntegrationAction(workspaceId, providerConfigKey, connectionId);
                if (result.error) { reject(new Error(result.error)); return; }
                if (result.integrationId) {
                  fetch("/api/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ integrationId: result.integrationId }),
                  }).catch(console.error);
                }
                setConnected(true);
                onConnected?.(providerId);
                resolve();
              } catch (err) { reject(err); }
            } else if (event.type === "error") {
              reject(new Error(event.payload.errorMessage));
            } else if (event.type === "close") {
              if (!connectDone) resolve();
            }
          },
        });
        connectUI.open();
      });
    } catch (err) {
      console.error("Connect failed:", err);
    } finally {
      // Always force-remove the Nango ConnectUI iframe and restore scroll
      const leftover = document.getElementById("connect-ui");
      if (leftover) {
        leftover.remove();
        document.body.style.overflow = "";
      }
      setConnecting(false);
    }
  }

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
      connected ? "border-[#4ADE80]/30 bg-[#4ADE80]/5" : "border-[#2A2D35] bg-[#1C1F24]"
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
      ) : connected ? (
        <span className="inline-flex items-center gap-1 text-xs text-[#4ADE80] px-3 py-1.5 rounded-lg bg-[#4ADE80]/10">
          <Check className="w-3.5 h-3.5" /> Connected
        </span>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
          style={{ backgroundColor: accentColor }}
        >
          {connecting && <Loader2 className="w-3 h-3 animate-spin" />}
          {connecting ? "Connecting..." : "Connect"}
        </button>
      )}
    </div>
  );
}

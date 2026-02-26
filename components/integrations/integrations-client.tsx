"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Nango from "@nangohq/frontend";
import type { ConnectUIEvent } from "@nangohq/frontend";
import {
  connectIntegrationAction,
  disconnectIntegrationAction,
} from "@/app/actions/integrations";

type Integration = {
  id: string;
  workspace_id: string;
  provider: string;
  status: string;
  sync_status: string | null;
  sync_error: string | null;
  synced_count: number | null;
  nango_connection_id: string | null;
  last_synced_at: string | null;
};

type IntegrationConfig = {
  provider: string;
  name: string;
  category: string;
  color: string;
};

const CORE_INTEGRATIONS: IntegrationConfig[] = [
  { provider: "gmail",           name: "Gmail",           category: "Email",         color: "#EA4335" },
  { provider: "slack",           name: "Slack",           category: "Communication", color: "#4A154B" },
  { provider: "google-calendar", name: "Google Calendar", category: "Calendar",      color: "#1A73E8" },
  { provider: "hubspot",         name: "HubSpot",         category: "CRM",           color: "#FF7A59" },
  { provider: "google-drive",    name: "Google Drive",    category: "Knowledge",     color: "#34A853" },
];

const COMING_SOON_INTEGRATIONS: IntegrationConfig[] = [
  { provider: "salesforce",       name: "Salesforce",       category: "CRM",          color: "#00A1E0" },
  { provider: "outlook",          name: "Outlook",          category: "Email",         color: "#0072C6" },
  { provider: "microsoft-teams",  name: "Microsoft Teams",  category: "Communication", color: "#6264A7" },
  { provider: "notion",           name: "Notion",           category: "Knowledge",     color: "#000000" },
  { provider: "confluence",       name: "Confluence",       category: "Knowledge",     color: "#172B4D" },
  { provider: "zendesk",          name: "Zendesk",          category: "Support",       color: "#03363D" },
  { provider: "intercom",         name: "Intercom",         category: "Support",       color: "#286EFA" },
  { provider: "stripe",           name: "Stripe",           category: "Payments",      color: "#635BFF" },
  { provider: "linear",           name: "Linear",           category: "Project Mgmt",  color: "#5E6AD2" },
  { provider: "apollo",           name: "Apollo.io",        category: "Sales",         color: "#F06623" },
];

const POLL_INTERVAL_MS = 5000;

function getRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function StatusBadge({ status, syncStatus }: { status: string; syncStatus: string | null }) {
  // sync_status from DB is the source of truth while a background job runs
  const effective =
    syncStatus === "syncing" ? "syncing" :
    syncStatus === "error"   ? "error"   :
    status;

  const map: Record<string, { dot: string; label: string; bg: string; text: string }> = {
    connected:    { dot: "bg-[#4ADE80]",               label: "Connected",    bg: "bg-[#4ADE80]/10", text: "text-[#4ADE80]"  },
    disconnected: { dot: "bg-[#8B8F97]",               label: "Disconnected", bg: "bg-[#8B8F97]/10", text: "text-[#8B8F97]"  },
    syncing:      { dot: "bg-[#3A89FF] animate-pulse", label: "Syncing…",     bg: "bg-[#3A89FF]/10", text: "text-[#3A89FF]"  },
    error:        { dot: "bg-[#F87171]",               label: "Error",        bg: "bg-[#F87171]/10", text: "text-[#F87171]"  },
  };

  const c = map[effective] ?? map.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function IntegrationCard({
  config,
  integration,
  workspaceId,
  onConnect,
}: {
  config: IntegrationConfig;
  integration: Integration | undefined;
  workspaceId: string;
  onConnect: (provider: string) => Promise<void>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"sync" | "connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = integration?.status ?? "disconnected";
  const syncStatus = integration?.sync_status ?? null;
  // Drive syncing state purely from DB — local `loading` only covers the
  // brief window between clicking and the first router.refresh() completing.
  const isSyncing = syncStatus === "syncing";
  const isConnected = status === "connected" || status === "syncing";

  async function handleConnect() {
    setLoading("connect");
    setError(null);
    try {
      await onConnect(config.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    if (!integration) return;
    setLoading("disconnect");
    setError(null);
    try {
      const result = await disconnectIntegrationAction(integration.id);
      if (result.error) setError(result.error);
      else router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleSync() {
    if (!integration) return;
    setLoading("sync"); // prevents double-click while the request is in-flight
    setError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integration.id }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to start sync");
      } else {
        // API sets sync_status = "syncing" in DB before returning.
        // Refresh immediately so the DB state drives the UI from here on —
        // isSyncing will become true via syncStatus, not local loading.
        router.refresh();
      }
    } catch {
      setError("Failed to start sync");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: config.color }}
          >
            {config.name[0]}
          </div>
          <div>
            <div className="font-semibold text-white text-sm">{config.name}</div>
            <div className="text-xs text-[#8B8F97]">{config.category}</div>
          </div>
        </div>
        <StatusBadge status={status} syncStatus={syncStatus} />
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-[#8B8F97]">
        <span>Last synced: {getRelativeTime(integration?.last_synced_at ?? null)}</span>
        {integration?.synced_count != null && integration.synced_count > 0 && (
          <span className="text-[#8B8F97]">{integration.synced_count.toLocaleString()} records</span>
        )}
      </div>

      {/* Error from sync_error column */}
      {syncStatus === "error" && integration?.sync_error && (
        <div className="text-xs text-[#F87171] bg-[#F87171]/10 rounded-lg px-3 py-2 break-words">
          {integration.sync_error}
        </div>
      )}

      {/* Local error (connect/disconnect) */}
      {error && (
        <div className="text-xs text-[#F87171] bg-[#F87171]/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        {isConnected ? (
          <>
            <button
              onClick={handleSync}
              disabled={isSyncing || loading === "sync"}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#3A89FF] text-white hover:bg-[#2d7aff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing || loading === "sync" ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Syncing…
                </span>
              ) : "Sync Now"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={isSyncing || !!loading}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2A2D35] text-[#8B8F97] hover:text-white hover:bg-[#3A3D45] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!!loading}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#3A89FF] text-white hover:bg-[#2d7aff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading === "connect" ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}

function ComingSoonCard({ config }: { config: IntegrationConfig }) {
  return (
    <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-5 flex flex-col gap-4 opacity-50">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: config.color }}
          >
            {config.name[0]}
          </div>
          <div>
            <div className="font-semibold text-white text-sm">{config.name}</div>
            <div className="text-xs text-[#8B8F97]">{config.category}</div>
          </div>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#FB923C]/10 text-[#FB923C]">
          Coming Soon
        </span>
      </div>
      <div className="text-xs text-[#8B8F97]">Last synced: Never</div>
    </div>
  );
}

export function IntegrationsClient({
  integrations: initialIntegrations,
  workspaceId,
}: {
  integrations: Integration[];
  workspaceId: string;
}) {
  const router = useRouter();
  const [integrations, setIntegrations] = useState(initialIntegrations);

  // Keep local state in sync when the server re-renders (router.refresh)
  useEffect(() => {
    setIntegrations(initialIntegrations);
  }, [initialIntegrations]);

  // Poll every 5 s while any integration is actively syncing
  useEffect(() => {
    const anySyncing = integrations.some((i) => i.sync_status === "syncing");
    if (!anySyncing) return;

    const id = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [integrations, router]);

  const integrationsByProvider = Object.fromEntries(
    integrations.map((i) => [i.provider, i])
  );

  const handleConnect = useCallback(
    async (provider: string) => {
      // 1. Get Nango session token
      const tokenRes = await fetch("/api/nango-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to create Nango session");
      }

      const { token } = (await tokenRes.json()) as { token: string };

      // 2. Open Nango Connect UI
      await new Promise<void>((resolve, reject) => {
        const nango = new Nango({ connectSessionToken: token });

        const connectUI = nango.openConnectUI({
          onEvent: async (event: ConnectUIEvent) => {
            if (event.type === "connect") {
              const { connectionId, providerConfigKey } = event.payload;

              try {
                const result = await connectIntegrationAction(
                  workspaceId,
                  providerConfigKey,
                  connectionId
                );

                if (result.error) {
                  connectUI.close();
                  reject(new Error(result.error));
                  return;
                }

                // Kick off first sync as a background job
                if (result.integrationId) {
                  fetch("/api/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ integrationId: result.integrationId }),
                  }).catch(console.error);
                }

                connectUI.close();
                router.refresh();
                resolve();
              } catch (err) {
                connectUI.close();
                reject(err);
              }
            } else if (event.type === "error") {
              connectUI.close();
              reject(new Error(event.payload.errorMessage));
            } else if (event.type === "close") {
              resolve();
            }
          },
        });

        connectUI.open();
      });
    },
    [workspaceId, router]
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Integrations</h1>
        <p className="text-[#8B8F97] mt-1 text-sm">
          Connect your tools to sync data into CleverBrain.
        </p>
      </div>

      <div className="mb-2">
        <h2 className="text-sm font-semibold text-[#8B8F97] uppercase tracking-wider mb-4">
          Available
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CORE_INTEGRATIONS.map((config) => (
            <IntegrationCard
              key={config.provider}
              config={config}
              integration={integrationsByProvider[config.provider]}
              workspaceId={workspaceId}
              onConnect={handleConnect}
            />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-[#8B8F97] uppercase tracking-wider mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {COMING_SOON_INTEGRATIONS.map((config) => (
            <ComingSoonCard key={config.provider} config={config} />
          ))}
        </div>
      </div>
    </div>
  );
}

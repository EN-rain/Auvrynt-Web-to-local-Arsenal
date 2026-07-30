import type { ServerConfig } from "../config.js";
import { readConnectedClients } from "../connection-registry.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";
import type { RecentLogEntry } from "../infrastructure/logger.js";
import { recentLogEntries } from "../infrastructure/logger.js";
import { getPlaywrightRuntimeStatus } from "../playwright-runtime.js";
import { dashboardHtml } from "./dashboard-page.js";
import type { WorkspaceChangeAnalytics } from "./workspace-analytics.js";

export { dashboardHtml };

export type DashboardIntegrationKey = keyof ServerConfig["integrations"];
export type DashboardAgentState = "working" | "connected" | "waiting" | "stopping";

export interface DashboardIntegration {
  key: DashboardIntegrationKey;
  label: string;
  enabled: boolean;
  state: "connected" | "available" | "offline" | "disabled";
  detail: string;
}

export interface DashboardView {
  ready: boolean;
  agentState: DashboardAgentState;
  agentLastSeenAt?: string;
  activeToolCalls: number;
  agentProvider?: string;
  pid: number;
  uptimeSeconds: number;
  localMcpUrl: string;
  publicMcpUrl: string;
  allowedRoots: string[];
  sessions: number;
  maxSessions: number;
  runningProcesses: number;
  workspaceChanges: WorkspaceChangeAnalytics;
  integrations: DashboardIntegration[];
  logs: RecentLogEntry[];
}

export interface DashboardRuntimeSnapshot {
  ready: boolean;
  sessions: number;
  activeToolCalls: number;
  lastMcpActivityAt?: number;
  runningProcesses: number;
  workspaceChanges: WorkspaceChangeAnalytics;
}

const INTEGRATION_LABELS: Record<DashboardIntegrationKey, string> = {
  godotGdscript: "Godot GDScript",
  godotCsharp: "Godot C#",
  blender: "Blender",
  serena: "Serena",
  playwright: "Playwright",
};

export async function createDashboardView(
  config: ServerConfig,
  runtime: DashboardRuntimeSnapshot,
): Promise<DashboardView> {
  const discovered = await discoverLocalIntegrations().catch(() => undefined);
  const playwright = getPlaywrightRuntimeStatus();
  const integration = (
    key: DashboardIntegrationKey,
    connected: boolean,
    available: boolean,
    connectedDetail: string,
    availableDetail: string,
    offlineDetail: string,
  ): DashboardIntegration => {
    const enabled = config.integrations[key];
    if (!enabled) {
      return {
        key,
        label: INTEGRATION_LABELS[key],
        enabled,
        state: "disabled",
        detail: "Not included in the active profile.",
      };
    }
    if (connected) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "connected", detail: connectedDetail };
    }
    if (available) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "available", detail: availableDetail };
    }
    return { key, label: INTEGRATION_LABELS[key], enabled, state: "offline", detail: offlineDetail };
  };

  const godotConnected = Boolean(discovered?.ports.auvrynt_godot_bridge);
  const godotAvailable = Boolean(
    discovered
    && (processDetected(discovered, "godot")
      || discovered.executables.godot
      || discovered.executables.godotCsharp),
  );
  const blenderConnected = Boolean(
    discovered?.ports.auvrynt_blender_bridge || discovered?.ports.blender_lab_mcp,
  );
  const blenderAvailable = Boolean(
    discovered && (processDetected(discovered, "blender") || discovered.executables.blender),
  );
  const serenaConnected = Boolean(discovered && processDetected(discovered, "serena"));
  const serenaAvailable = Boolean(discovered?.executables.serena || config.serena.executable);
  const agentProvider = runtime.sessions > 0
    ? readConnectedClients(config.stateDir)[0]?.provider
    : undefined;
  const agentState: DashboardAgentState = !runtime.ready
    ? "stopping"
    : runtime.activeToolCalls > 0
      ? "working"
      : runtime.sessions > 0
        ? "connected"
        : "waiting";

  return {
    ready: runtime.ready,
    agentState,
    agentLastSeenAt: runtime.lastMcpActivityAt
      ? new Date(runtime.lastMcpActivityAt).toISOString()
      : undefined,
    activeToolCalls: runtime.activeToolCalls,
    agentProvider,
    pid: process.pid,
    uptimeSeconds: process.uptime(),
    localMcpUrl: localHttpUrl(config.host, config.port, "/mcp"),
    publicMcpUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`,
    allowedRoots: [...config.allowedRoots],
    sessions: runtime.sessions,
    maxSessions: config.maxSessions,
    runningProcesses: runtime.runningProcesses,
    workspaceChanges: runtime.workspaceChanges,
    integrations: [
      integration(
        "godotCsharp",
        godotConnected,
        godotAvailable,
        "Godot bridge is connected.",
        "Godot is available; waiting for the bridge.",
        "Godot or its bridge is not detected.",
      ),
      integration(
        "godotGdscript",
        godotConnected,
        godotAvailable,
        "Godot bridge is connected.",
        "Godot is available; waiting for the bridge.",
        "Godot or its bridge is not detected.",
      ),
      integration(
        "blender",
        blenderConnected,
        blenderAvailable,
        "Blender MCP bridge is connected.",
        "Blender is available; waiting for its bridge.",
        "Blender is not detected.",
      ),
      integration(
        "serena",
        serenaConnected,
        serenaAvailable,
        "Serena is running.",
        "Serena is detected and enabled by default.",
        "Serena is not detected.",
      ),
      integration(
        "playwright",
        false,
        playwright.chromiumInstalled,
        "Playwright browser is active.",
        "Chromium is installed and starts on demand.",
        "Playwright Chromium is unavailable.",
      ),
    ],
    logs: recentLogEntries(250).reverse(),
  };
}

export function dashboardCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function localHttpUrl(host: string, port: number, path: string): string {
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = probeHost.includes(":") && !probeHost.startsWith("[")
    ? `[${probeHost}]`
    : probeHost;
  return `http://${formattedHost}:${port}${path}`;
}

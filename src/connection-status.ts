import type { ServerConfig } from "./config.js";
import type { ProcessManager } from "./processes.js";
import { getBlenderClient } from "./blender-client.js";
import { godotEditorStatus } from "./godot-editor-bridge.js";
import { discoverLocalIntegrations, processDetected } from "./integration-discovery.js";
import type { WorkspaceRegistry } from "./workspaces.js";
import { getPlaywrightRuntimeStatus } from "./playwright-runtime.js";

export type ConnectionState =
  | "connected"
  | "available"
  | "disconnected"
  | "unavailable"
  | "not_configured"
  | "disabled"
  | "unauthorized"
  | "error";

export interface IntegrationStatus {
  state: ConnectionState;
  provider?: string;
  endpoint?: string;
  detail?: string;
  checkedAt: string;
  metadata?: unknown;
}

function checkedAt(): string {
  return new Date().toISOString();
}

function unavailableByPolicy(provider: string, enabled: boolean, authorized: boolean, timestamp: string): IntegrationStatus | undefined {
  if (!enabled) {
    return {
      state: "disabled",
      provider,
      detail: "This integration is disabled in Auvrynt configuration.",
      checkedAt: timestamp,
    };
  }
  if (!authorized) {
    return {
      state: "unauthorized",
      provider,
      detail: "The current OAuth token was not granted this integration scope.",
      checkedAt: timestamp,
    };
  }
  return undefined;
}

function browserStatus(config: ServerConfig, authorized: boolean, timestamp: string): IntegrationStatus {
  const policy = unavailableByPolicy("Playwright", config.integrations.playwright, authorized, timestamp);
  if (policy) return policy;

  const status = getPlaywrightRuntimeStatus();
  if (status.chromiumInstalled) {
    return {
      state: "available",
      provider: "Playwright",
      detail: `Browser support is ready${status.source ? ` (${status.source})` : ""} and will launch on demand.`,
      checkedAt: timestamp,
    };
  }

  return {
    state: status.packageInstalled ? "unavailable" : "not_configured",
    provider: "Playwright",
    detail: status.packageInstalled
      ? "Playwright is installed but Chromium is missing. Run `auvrynt start` to repair it automatically."
      : "Playwright is not installed. Run `auvrynt start` to install managed browser support automatically.",
    checkedAt: timestamp,
  };
}

export async function getConnectionStatus(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  config: ServerConfig,
  scopes: readonly string[],
  workspaceId: string,
): Promise<{
  checkedAt: string;
  workspace: { id: string; root: string; mode: string };
  connections: Record<string, IntegrationStatus>;
  processes: ReturnType<ProcessManager["listProcesses"]>;
}> {
  const workspace = registry.getWorkspace(workspaceId);
  const timestamp = checkedAt();
  const scopeSet = new Set(scopes);
  const local = await discoverLocalIntegrations();

  const blenderPolicy = unavailableByPolicy(
    "Auvrynt Blender bridge",
    config.integrations.blender,
    scopeSet.has("auvrynt:blender"),
    timestamp,
  );
  let blender: IntegrationStatus;
  let blenderLabMcp: IntegrationStatus;
  if (blenderPolicy) {
    blender = blenderPolicy;
    blenderLabMcp = { ...blenderPolicy, provider: "Blender Lab MCP" };
  } else {
    blender = {
      state: "disconnected",
      provider: "Auvrynt Blender bridge",
      endpoint: "127.0.0.1:49323",
      detail: "No response from the local Blender bridge.",
      checkedAt: timestamp,
    };
    try {
      const response = await getBlenderClient(workspaceId).sendExecute(
        "import bpy\nresult = {'version': bpy.app.version_string}\n",
      );
      blender.state = "connected";
      blender.detail = "Blender bridge responded. Workspace file binding is verified before scene tools run.";
      blender.metadata = response;
    } catch (error) {
      blender.detail = error instanceof Error ? error.message : String(error);
    }

    blenderLabMcp = {
      state: local.ports.blender_lab_mcp ? "connected" : processDetected(local, "blender") ? "available" : "disconnected",
      provider: "Blender Lab MCP",
      endpoint: `127.0.0.1:${process.env.AUVRYNT_BLENDER_MCP_PORT ?? "9876"}`,
      detail: local.ports.blender_lab_mcp
        ? "Blender MCP is listening on the configured Blender Lab endpoint."
        : processDetected(local, "blender")
          ? "Blender is running, but its MCP endpoint is not reachable. Check Blender MCP Auto Start and port 9876."
          : "Blender is not detected. Start Blender with the MCP extension enabled for automatic connection.",
      checkedAt: timestamp,
    };
  }

  const godotEnabled = config.integrations.godotGdscript || config.integrations.godotCsharp;
  const godotPolicy = unavailableByPolicy(
    "Auvrynt Godot editor bridge",
    godotEnabled,
    scopeSet.has("auvrynt:godot"),
    timestamp,
  );
  let godot: IntegrationStatus;
  let godotMcp: IntegrationStatus;
  if (godotPolicy) {
    godot = godotPolicy;
    godotMcp = { ...godotPolicy, provider: "Godot / Codex MCP" };
  } else {
    try {
      const response = await godotEditorStatus({ workspaceId });
      godot = {
        state: response.connected ? "connected" : "disconnected",
        provider: "Auvrynt Godot editor bridge",
        endpoint: "127.0.0.1:49322",
        detail: response.connected ? "Godot editor bridge responded for this workspace." : "Godot editor bridge is not connected.",
        checkedAt: timestamp,
        metadata: response.connected ? response : undefined,
      };
    } catch (error) {
      godot = {
        state: "error",
        provider: "Auvrynt Godot editor bridge",
        endpoint: "127.0.0.1:49322",
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: timestamp,
      };
    }

    godotMcp = {
      state: local.ports.auvrynt_godot_bridge ? "connected" : processDetected(local, "godot") ? "available" : "disconnected",
      provider: "Godot / Codex MCP",
      endpoint: "local process or 127.0.0.1:49322",
      detail: local.ports.auvrynt_godot_bridge
        ? "Auvrynt Godot bridge is reachable."
        : processDetected(local, "godot")
          ? "Godot is running, but no reachable Auvrynt bridge was found. Enable the bridge or Codex Godot MCP."
          : "Godot is not detected. Start Godot with the Auvrynt bridge or Codex Godot MCP enabled.",
      checkedAt: timestamp,
    };
  }

  const cloudflare: IntegrationStatus = {
    state: processDetected(local, "cloudflare_tunnel") ? "connected" : local.executables.cloudflared ? "available" : "unavailable",
    provider: "Cloudflare Tunnel",
    detail: processDetected(local, "cloudflare_tunnel")
      ? "cloudflared is running."
      : local.executables.cloudflared
        ? "cloudflared is installed, but no tunnel process is running."
        : "cloudflared is not installed.",
    checkedAt: timestamp,
  };

  const serenaPolicy = unavailableByPolicy(
    "Serena",
    config.integrations.serena && config.serena.enabled,
    scopeSet.has("auvrynt:serena"),
    timestamp,
  );
  const serena: IntegrationStatus = serenaPolicy ?? {
    state: processDetected(local, "serena") ? "connected" : local.executables.serena ? "available" : "unavailable",
    provider: "Serena",
    detail: processDetected(local, "serena")
      ? "Serena process detected."
      : local.executables.serena
        ? "Serena is installed and available on demand."
        : "Serena is not installed or not available on PATH.",
    checkedAt: timestamp,
  };

  const webAuthorized = scopeSet.has("auvrynt:web");

  return {
    checkedAt: timestamp,
    workspace: { id: workspace.id, root: workspace.root, mode: workspace.mode },
    connections: {
      mcp: {
        state: "connected",
        provider: "Auvrynt MCP server",
        detail: "This status request was received through the authenticated MCP connection.",
        checkedAt: timestamp,
      },
      blender,
      blender_lab_mcp: blenderLabMcp,
      godot,
      godot_mcp: godotMcp,
      cloudflare_tunnel: cloudflare,
      serena,
      browser: browserStatus(config, webAuthorized, timestamp),
      chrome_mcp: webAuthorized
        ? {
            state: "not_configured",
            provider: "Chrome MCP",
            detail: "No Chrome MCP adapter is registered in this Auvrynt build.",
            checkedAt: timestamp,
          }
        : {
            state: "unauthorized",
            provider: "Chrome MCP",
            detail: "The current OAuth token was not granted web access.",
            checkedAt: timestamp,
          },
    },
    processes: scopeSet.has("auvrynt:process") ? processManager.listProcesses({ workspaceId }) : [],
  };
}

import { createRequire } from "node:module";
import type { ProcessManager } from "./processes.js";
import { getBlenderClient } from "./blender-client.js";
import { godotEditorStatus } from "./godot-editor-bridge.js";
import { discoverLocalIntegrations, processDetected } from "./integration-discovery.js";
import type { WorkspaceRegistry } from "./workspaces.js";

const require = createRequire(import.meta.url);

export type ConnectionState = "connected" | "available" | "disconnected" | "unavailable" | "not_configured" | "error";

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

function browserStatus(): IntegrationStatus {
  const timestamp = checkedAt();
  for (const packageName of ["playwright", "playwright-core"]) {
    try {
      require.resolve(packageName);
      return {
        state: "available",
        provider: "Playwright",
        detail: "Browser support is installed and will connect on demand per request.",
        checkedAt: timestamp,
      };
    } catch {}
  }

  return {
    state: "unavailable",
    provider: "Playwright",
    detail: "Install Playwright to enable browser inspection and screenshots.",
    checkedAt: timestamp,
  };
}

export async function getConnectionStatus(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  workspaceId: string,
): Promise<{
  checkedAt: string;
  workspace: { id: string; root: string; mode: string };
  connections: Record<string, IntegrationStatus>;
  processes: ReturnType<ProcessManager["listProcesses"]>;
}> {
  const workspace = registry.getWorkspace(workspaceId);
  const timestamp = checkedAt();
  const local = await discoverLocalIntegrations();

  const blender: IntegrationStatus = {
    state: "disconnected",
    provider: "Auvrynt Blender bridge",
    endpoint: "127.0.0.1:49323",
    detail: "No response from the local Blender bridge.",
    checkedAt: timestamp,
  };
  try {
    const response = await getBlenderClient(workspaceId).sendExecute(
      "import bpy\nresult = {'version': bpy.app.version_string, 'scene': bpy.context.scene.name}\n",
    );
    blender.state = "connected";
    blender.detail = "Blender bridge responded.";
    blender.metadata = response;
  } catch (error) {
    blender.detail = error instanceof Error ? error.message : String(error);
  }

  const blenderLabMcp: IntegrationStatus = {
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

  let godot: IntegrationStatus;
  try {
    const response = await godotEditorStatus({ workspaceId });
    godot = {
      state: response.connected ? "connected" : "disconnected",
      provider: "Auvrynt Godot editor bridge",
      endpoint: "127.0.0.1:49322",
      detail: response.connected ? "Godot editor bridge responded." : "Godot editor bridge is not connected.",
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

  const godotMcp: IntegrationStatus = {
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

  const cloudflare: IntegrationStatus = {
    state: processDetected(local, "cloudflare_tunnel") ? "connected" : local.executables.cloudflared ? "available" : "unavailable",
    provider: "Cloudflare Tunnel",
    detail: processDetected(local, "cloudflare_tunnel")
      ? "cloudflared is running."
      : local.executables.cloudflared
        ? `cloudflared is installed at ${local.executables.cloudflared}, but no tunnel process is running.`
        : "cloudflared is not installed. Install it to expose /mcp through Cloudflare Tunnel.",
    checkedAt: timestamp,
  };

  const serena: IntegrationStatus = {
    state: processDetected(local, "serena") ? "connected" : local.executables.serena ? "available" : "unavailable",
    provider: "Serena",
    detail: processDetected(local, "serena")
      ? "Serena process detected."
      : local.executables.serena
        ? `Serena is installed at ${local.executables.serena} and available on demand.`
        : "Serena is not installed or not available on PATH.",
    checkedAt: timestamp,
  };

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
      browser: browserStatus(),
      chrome_mcp: {
        state: "not_configured",
        provider: "Chrome MCP",
        detail: "No Chrome MCP adapter is registered in this Auvrynt build.",
        checkedAt: timestamp,
      },
    },
    processes: processManager.listProcesses({ workspaceId }),
  };
}

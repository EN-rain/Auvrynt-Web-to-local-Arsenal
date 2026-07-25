import { createRequire } from "node:module";
import type { ProcessManager } from "./processes.js";
import { getBlenderClient } from "./blender-client.js";
import { godotEditorStatus } from "./godot-editor-bridge.js";
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
      godot,
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

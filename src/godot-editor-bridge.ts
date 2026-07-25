import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { WorkspaceRegistry } from "./workspaces.js";

export interface GodotEditorConnectInput {
  workspaceId: string;
  projectPath: string;
  host?: string;
  port?: number;
  token?: string;
}

export interface GodotEditorStatusResult {
  connected: boolean;
  godotVersion?: string;
  projectPath?: string;
  projectName?: string;
  activeScene?: string;
  protocolVersion: number;
  csharpAssemblyState?: string;
}

export interface GodotGetSceneTreeInput {
  workspaceId: string;
  mode?: "edited" | "remote";
  maxDepth?: number;
  includeInternal?: boolean;
}

export interface GodotSetNodePropertyInput {
  workspaceId: string;
  nodePath: string;
  property: string;
  value: unknown;
}

export interface GodotCreateNodeInput {
  workspaceId: string;
  parentPath: string;
  type: string;
  name: string;
  properties?: Record<string, unknown>;
}

export interface GodotAttachCsharpScriptInput {
  workspaceId: string;
  nodePath: string;
  scriptPath: string;
  className?: string;
  createIfMissing?: boolean;
}

export class GodotEditorBridgeClient {
  private socket: Socket | null = null;
  private token: string = "";
  private isConnected = false;

  async connect(host = "127.0.0.1", port = 49322, token = ""): Promise<boolean> {
    this.token = token;
    return new Promise((resolve) => {
      try {
        this.socket = createConnection({ host, port }, () => {
          this.isConnected = true;
          resolve(true);
        });

        this.socket.on("error", () => {
          this.isConnected = false;
          resolve(false);
        });

        this.socket.on("close", () => {
          this.isConnected = false;
        });
      } catch {
        this.isConnected = false;
        resolve(false);
      }
    });
  }

  async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.socket || !this.isConnected) {
      throw new Error("Godot Editor Bridge is not connected.");
    }

    const requestId = randomUUID();
    const payload = JSON.stringify({
      protocolVersion: 1,
      requestId,
      token: this.token,
      method,
      params,
    }) + "\n";

    return new Promise((resolve, reject) => {
      let buffer = "";
      const onData = (data: Buffer) => {
        buffer += data.toString("utf8");
        while (true) {
          const nlIndex = buffer.indexOf("\n");
          if (nlIndex === -1) break;
          const line = buffer.slice(0, nlIndex).trim();
          buffer = buffer.slice(nlIndex + 1);

          if (!line) continue;
          try {
            const resp = JSON.parse(line);
            if (resp.requestId === requestId) {
              this.socket?.off("data", onData);
              if (resp.ok) resolve(resp.result);
              else reject(new Error(resp.result?.error ?? "Bridge request failed"));
              return;
            }
          } catch {}
        }
      };

      this.socket?.on("data", onData);
      this.socket?.write(payload);

      setTimeout(() => {
        this.socket?.off("data", onData);
        reject(new Error("Bridge request timeout"));
      }, 5000);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.isConnected = false;
    }
  }

  get status(): boolean {
    return this.isConnected;
  }
}

const activeBridges = new Map<string, GodotEditorBridgeClient>();

export function getBridgeClient(workspaceId: string): GodotEditorBridgeClient {
  let client = activeBridges.get(workspaceId);
  if (!client) {
    client = new GodotEditorBridgeClient();
    activeBridges.set(workspaceId, client);
  }
  return client;
}

export async function godotEditorConnect(
  registry: WorkspaceRegistry,
  input: GodotEditorConnectInput,
): Promise<GodotEditorStatusResult> {
  const client = getBridgeClient(input.workspaceId);
  const connected = await client.connect(input.host ?? "127.0.0.1", input.port ?? 49322, input.token ?? "");

  if (!connected) {
    return {
      connected: false,
      protocolVersion: 1,
    };
  }

  try {
    const res = await client.sendRequest("status");
    return {
      connected: true,
      godotVersion: res.godotVersion,
      projectPath: res.projectPath,
      protocolVersion: res.protocolVersion ?? 1,
    };
  } catch {
    return {
      connected: true,
      protocolVersion: 1,
    };
  }
}

export async function godotEditorStatus(
  input: { workspaceId: string },
): Promise<GodotEditorStatusResult> {
  const client = getBridgeClient(input.workspaceId);
  if (!client.status) {
    return { connected: false, protocolVersion: 1 };
  }

  try {
    const res = await client.sendRequest("status");
    return { connected: true, ...res, protocolVersion: 1 };
  } catch {
    return { connected: false, protocolVersion: 1 };
  }
}

export function godotEditorDisconnect(input: { workspaceId: string }): { disconnected: boolean } {
  const client = activeBridges.get(input.workspaceId);
  if (client) {
    client.disconnect();
    activeBridges.delete(input.workspaceId);
  }
  return { disconnected: true };
}

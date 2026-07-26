import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

interface BridgeResponse {
  requestId?: unknown;
  ok?: unknown;
  result?: unknown;
}

const MAX_ACTIVE_BRIDGES = 32;
const MAX_RESPONSE_BUFFER_CHARS = 2 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;

function normalizeLoopbackHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return "127.0.0.1";
  if (normalized === "127.0.0.1" || normalized === "::1") return normalized;
  throw new Error(`Forbidden Godot bridge host: ${host}. Only loopback connections are allowed.`);
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Godot bridge port: ${port}`);
  }
  return port;
}

async function canonicalProjectDirectory(path: string): Promise<string> {
  let target = resolve(path);
  try {
    const info = await stat(target);
    if (info.isFile()) target = dirname(target);
  } catch {
    // realpath below will provide the useful failure.
  }
  return realpath(target);
}

function bridgeError(result: unknown): string {
  if (result && typeof result === "object" && "error" in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return "Bridge request failed";
}

export class GodotEditorBridgeClient {
  private socket: Socket | null = null;
  private token = "";
  private isConnected = false;
  private boundProjectRoot: string | undefined;

  async connect(host = "127.0.0.1", port = 49322, token = ""): Promise<boolean> {
    const safeHost = normalizeLoopbackHost(host);
    const safePort = validatePort(port);
    this.disconnect();
    this.token = token;

    return new Promise((resolveConnection) => {
      let settled = false;
      const finish = (connected: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.isConnected = connected;
        resolveConnection(connected);
      };

      const timeout = setTimeout(() => {
        this.socket?.destroy();
        finish(false);
      }, CONNECT_TIMEOUT_MS);

      try {
        const socket = createConnection({ host: safeHost, port: safePort }, () => finish(true));
        this.socket = socket;
        socket.setNoDelay(true);
        socket.on("error", () => finish(false));
        socket.on("close", () => {
          this.isConnected = false;
          if (this.socket === socket) this.socket = null;
        });
      } catch {
        finish(false);
      }
    });
  }

  bindProjectRoot(projectRoot: string): void {
    this.boundProjectRoot = projectRoot;
  }

  get projectRoot(): string | undefined {
    return this.boundProjectRoot;
  }

  async sendRequest<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket;
    if (!socket || !this.isConnected) {
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

    return new Promise((resolveRequest, rejectRequest) => {
      let buffer = "";
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("data", onData);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      const finishResolve = (value: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveRequest(value as T);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectRequest(error);
      };
      const onClose = () => finishReject(new Error("Godot Editor Bridge closed the connection."));
      const onError = (error: Error) => finishReject(new Error(`Godot Editor Bridge socket error: ${error.message}`));
      const onData = (data: Buffer) => {
        buffer += data.toString("utf8");
        if (buffer.length > MAX_RESPONSE_BUFFER_CHARS) {
          finishReject(new Error("Godot Editor Bridge response exceeded the 2 MB limit."));
          return;
        }
        while (!settled) {
          const nlIndex = buffer.indexOf("\n");
          if (nlIndex === -1) break;
          const line = buffer.slice(0, nlIndex).trim();
          buffer = buffer.slice(nlIndex + 1);
          if (!line) continue;

          let response: BridgeResponse;
          try {
            response = JSON.parse(line) as BridgeResponse;
          } catch {
            continue;
          }
          if (response.requestId !== requestId) continue;
          if (response.ok === true) finishResolve(response.result);
          else finishReject(new Error(bridgeError(response.result)));
        }
      };

      const timeout = setTimeout(
        () => finishReject(new Error("Godot Editor Bridge request timeout.")),
        REQUEST_TIMEOUT_MS,
      );
      socket.on("data", onData);
      socket.once("close", onClose);
      socket.once("error", onError);
      socket.write(payload, (error) => {
        if (error) finishReject(new Error(`Godot Editor Bridge write failed: ${error.message}`));
      });
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.isConnected = false;
    this.boundProjectRoot = undefined;
    socket?.destroy();
  }

  get status(): boolean {
    return this.isConnected;
  }
}

const activeBridges = new Map<string, GodotEditorBridgeClient>();

export function getBridgeClient(workspaceId: string): GodotEditorBridgeClient {
  let client = activeBridges.get(workspaceId);
  if (!client) {
    if (activeBridges.size >= MAX_ACTIVE_BRIDGES) {
      throw new Error(`Godot bridge capacity reached (max ${MAX_ACTIVE_BRIDGES} workspaces).`);
    }
    client = new GodotEditorBridgeClient();
    activeBridges.set(workspaceId, client);
  }
  return client;
}

export async function godotEditorConnect(
  registry: WorkspaceRegistry,
  input: GodotEditorConnectInput,
): Promise<GodotEditorStatusResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const requestedPath = registry.resolvePath(workspace, input.projectPath);
  const requestedProjectRoot = await canonicalProjectDirectory(requestedPath);
  const client = getBridgeClient(input.workspaceId);
  const connected = await client.connect(
    input.host ?? "127.0.0.1",
    input.port ?? 49322,
    input.token ?? "",
  );

  if (!connected) {
    return { connected: false, protocolVersion: 1 };
  }

  try {
    const rawStatus = await client.sendRequest("status");
    if (!rawStatus || typeof rawStatus !== "object") {
      throw new Error("Godot bridge returned an invalid status payload.");
    }
    const status = rawStatus as Record<string, unknown>;
    if (typeof status.projectPath !== "string" || !status.projectPath.trim()) {
      throw new Error("Godot bridge did not report a project path.");
    }
    const bridgeProjectRoot = await canonicalProjectDirectory(status.projectPath);
    if (bridgeProjectRoot !== requestedProjectRoot) {
      throw new Error(
        `Godot bridge project mismatch. Expected ${requestedProjectRoot}, received ${bridgeProjectRoot}.`,
      );
    }
    client.bindProjectRoot(requestedProjectRoot);
    return {
      connected: true,
      godotVersion: typeof status.godotVersion === "string" ? status.godotVersion : undefined,
      projectPath: requestedProjectRoot,
      projectName: typeof status.projectName === "string" ? status.projectName : undefined,
      activeScene: typeof status.activeScene === "string" ? status.activeScene : undefined,
      protocolVersion: typeof status.protocolVersion === "number" ? status.protocolVersion : 1,
      csharpAssemblyState: typeof status.csharpAssemblyState === "string" ? status.csharpAssemblyState : undefined,
    };
  } catch (error) {
    client.disconnect();
    activeBridges.delete(input.workspaceId);
    throw error;
  }
}

export async function godotEditorStatus(
  input: { workspaceId: string },
): Promise<GodotEditorStatusResult> {
  const client = activeBridges.get(input.workspaceId);
  if (!client?.status) return { connected: false, protocolVersion: 1 };

  try {
    const rawStatus = await client.sendRequest("status");
    if (!rawStatus || typeof rawStatus !== "object") return { connected: false, protocolVersion: 1 };
    const status = rawStatus as Record<string, unknown>;
    if (client.projectRoot && typeof status.projectPath === "string") {
      const bridgeProjectRoot = await canonicalProjectDirectory(status.projectPath);
      if (bridgeProjectRoot !== client.projectRoot) {
        client.disconnect();
        activeBridges.delete(input.workspaceId);
        return { connected: false, protocolVersion: 1 };
      }
    }
    return {
      connected: true,
      godotVersion: typeof status.godotVersion === "string" ? status.godotVersion : undefined,
      projectPath: client.projectRoot,
      projectName: typeof status.projectName === "string" ? status.projectName : undefined,
      activeScene: typeof status.activeScene === "string" ? status.activeScene : undefined,
      protocolVersion: typeof status.protocolVersion === "number" ? status.protocolVersion : 1,
      csharpAssemblyState: typeof status.csharpAssemblyState === "string" ? status.csharpAssemblyState : undefined,
    };
  } catch {
    client.disconnect();
    activeBridges.delete(input.workspaceId);
    return { connected: false, protocolVersion: 1 };
  }
}

export function godotEditorDisconnect(input: { workspaceId: string }): { disconnected: boolean } {
  const client = activeBridges.get(input.workspaceId);
  client?.disconnect();
  activeBridges.delete(input.workspaceId);
  return { disconnected: true };
}

export function disconnectAllGodotEditorBridges(): void {
  for (const client of activeBridges.values()) client.disconnect();
  activeBridges.clear();
}

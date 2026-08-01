import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool as registerExtAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ServerConfig } from "../config.js";
import type { WorkspaceRegistry } from "../workspaces.js";
import type { RoomRegistry } from "../room-registry.js";
import { assertBlenderWorkspaceBound } from "../blender-tools.js";
import { getRequestContext, runWithContext } from "../request-context.js";
import { enqueueIntegration } from "../integration-queue.js";
import { registerToolCapability } from "../tool-capabilities.js";
import { limitToolResultPayload } from "../tool-result-budget.js";
import {
  hasRequiredScopes,
  requiredScopesForToolCall,
  requiredScopesForToolName,
  toolIntegrationEnabled,
} from "./mcp-policy.js";

export interface McpToolGuardContext {
  config: ServerConfig;
  workspaces: WorkspaceRegistry;
  rooms: RoomRegistry;
}

const guards = new WeakMap<McpServer, McpToolGuardContext>();
const registeredTools = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const BLENDER_UNBOUND_TOOL_NAMES = new Set([
  "blender_ping",
  "blender_get_current_file",
  "blender_open_file",
  "blender_save_file_as",
  "blender_list_checkpoints",
]);

export function configureMcpToolGuard(server: McpServer, context: McpToolGuardContext): void {
  guards.set(server, context);
  if (!registeredTools.has(server)) registeredTools.set(server, new Map());
}

export function syncMcpToolAvailability(
  server: McpServer,
  config: ServerConfig,
): { enabled: number; disabled: number } {
  const tools = registeredTools.get(server);
  if (!tools) return { enabled: 0, disabled: 0 };

  let enabled = 0;
  let disabled = 0;
  for (const [name, tool] of tools) {
    const shouldEnable = toolIntegrationEnabled(config, name);
    if (shouldEnable && !tool.enabled) {
      tool.enable();
      enabled++;
    } else if (!shouldEnable && tool.enabled) {
      tool.disable();
      disabled++;
    }
  }
  return { enabled, disabled };
}

export const registerAppTool = ((server: McpServer, name: string, toolConfig: unknown, handler: Function) => {
  registerToolCapability(name);
  const guard = guards.get(server);
  const requiredScopes = requiredScopesForToolName(name);
  if (guard && !hasRequiredScopes(guard.config.oauth.scopes, requiredScopes)) return undefined;

  const guardedHandler = async (...args: unknown[]) => {
    const input = args[0];
    const extra = args.at(-1) as { authInfo?: { clientId?: string; scopes?: string[] } } | undefined;
    const requestContext = getRequestContext();
    const ownerClientId = requestContext?.ownerClientId ?? extra?.authInfo?.clientId;
    const callScopes = requiredScopesForToolCall(name, input);

    if (guard && !toolIntegrationEnabled(guard.config, name)) {
      throw new Error(`Forbidden: ${name} integration is disabled by the local profile`);
    }
    if (!extra?.authInfo?.scopes || !hasRequiredScopes(extra.authInfo.scopes, callScopes)) {
      throw new Error(`Forbidden: ${name} requires ${callScopes.join(" + ")}`);
    }

    let workspaceId: string | undefined;
    if (guard && input && typeof input === "object" && "workspaceId" in input) {
      const candidate = (input as { workspaceId?: unknown }).workspaceId;
      if (typeof candidate === "string") {
        if (!ownerClientId) throw new Error("Forbidden: workspace access requires an authenticated OAuth client");
        guard.rooms.requireWorkspaceAccess(ownerClientId, candidate);
        guard.workspaces.getWorkspace(candidate);
        workspaceId = candidate;
        if (name.startsWith("blender_") && !BLENDER_UNBOUND_TOOL_NAMES.has(name)) {
          await assertBlenderWorkspaceBound(guard.workspaces, candidate);
        }
      }
    }

    const invokeHandler = async () => limitToolResultPayload(
      await Reflect.apply(handler, undefined, args),
    );
    const invokeByIntegration = () => {
      if (name.startsWith("blender_")) return enqueueIntegration("blender", invokeHandler);
      if (name.startsWith("aseprite_")) return enqueueIntegration("aseprite", invokeHandler);
      if (name.startsWith("godot_")) return enqueueIntegration("godot", invokeHandler);
      if (name.startsWith("serena_")) return enqueueIntegration("serena", invokeHandler);
      return invokeHandler();
    };

    if (requestContext && workspaceId) {
      const room = guard?.rooms.requireWorkspaceAccess(requestContext.ownerClientId, workspaceId);
      return runWithContext({
        ...requestContext,
        workspaceId,
        roomId: room?.roomId,
      }, invokeByIntegration);
    }
    return invokeByIntegration();
  };

  const registered = Reflect.apply(
    registerExtAppTool,
    undefined,
    [server, name, toolConfig, guardedHandler],
  ) as RegisteredTool | undefined;
  if (!registered) return undefined;

  const tools = registeredTools.get(server) ?? new Map<string, RegisteredTool>();
  tools.set(name, registered);
  registeredTools.set(server, tools);
  if (guard && !toolIntegrationEnabled(guard.config, name)) {
    registered.disable();
  }
  return registered;
}) as unknown as typeof registerExtAppTool;
